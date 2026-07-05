/***************
 * CONFIG
 ***************/
const ORDERS_SHEET = 'Orders';
const PAYMENTS_SHEET = 'Payments';
const SECURITY_LOGS_SHEET = 'SecurityLogs';
const PROMOTIONS_SHEET = 'Promotions';
const PRODUCTS_SHEET = 'Products';
const TERMS_SHEET = 'Terms';

const FINANCE_SPREADSHEET_ID = '10HB8FULJZEE7czLQI4_o1U56vw5lQpWOVfvRKWxWMfo';
const DEFAULT_SHEET_NAME = 'Mar-Jun 2026';
const FINANCE_SETTINGS_SHEET = 'Settings';
const FINANCE_ACTIVE_SHEET_KEY = 'FINANCE_ACTIVE_SHEET';

const MAX_PET_PHOTOS = 6;
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;

const ORDER_STATUS_AWAITING_PROOF = 'Awaiting payment proof';
const PAYMENT_STATUS_PROOF_SUBMITTED = 'Proof submitted - verify manually';

/***************
 * MAIN ROUTE
 ***************/
function doPost(e) {
  try {
    const payload = parsePayload_(e);

    if (!payload || !payload.type) {
      return jsonResponse_({ success: false, error: 'INVALID_REQUEST' });
    }

    validateApiSecret_(payload);

    if (payload.type === 'products') return listProducts_();
    if (payload.type === 'terms') return listTerms_();
    if (payload.type === 'promo') return validatePromo_(payload);
    if (payload.type === 'order') return createOrder_(payload);
    if (payload.type === 'manage_lookup') return manageOrderLookup_(payload);
    if (payload.type === 'pet_photo') return uploadPetPhoto_(payload);
    if (payload.type === 'payment') return submitPayment_(payload);

    return jsonResponse_({ success: false, error: 'UNKNOWN_TYPE' });
  } catch (err) {
    try {
      logSecurity_('ERROR', '', String(err && err.message ? err.message : err));
    } catch (_) {}

    return jsonResponse_({
      success: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

/***************
 * API SECURITY
 ***************/
function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('EMPTY_BODY');
  }

  return JSON.parse(e.postData.contents);
}

function validateApiSecret_(payload) {
  const props = getRequiredProperties_();

  if (!payload.apiSecret || payload.apiSecret !== props.apiSecret) {
    throw new Error('UNAUTHORIZED');
  }
}

function getRequiredProperties_() {
  const props = PropertiesService.getScriptProperties();

  const sheetId = props.getProperty('SHEET_ID');
  const folderId = props.getProperty('PARENT_FOLDER_ID');
  const apiSecret = props.getProperty('API_SHARED_SECRET');

  if (!sheetId || !folderId || !apiSecret) {
    throw new Error('MISSING_SCRIPT_PROPERTIES');
  }

  return {
    sheetId: sheetId,
    folderId: folderId,
    apiSecret: apiSecret
  };
}

/***************
 * PRODUCTS
 ***************/
function listProducts_() {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);
  const products = getActiveProducts_(ss);

  return jsonResponse_({
    success: true,
    products: products
  });
}

function getActiveProducts_(ss) {
  const sheet = requireSheet_(ss, PRODUCTS_SHEET);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();

  return rows
    .map(function(row) {
      return {
        id: String(row[0] || '').trim(),
        name: String(row[1] || '').trim(),
        dims: String(row[2] || '').trim(),
        price: Number(row[3] || 0),
        capacity: String(row[4] || '').trim(),
        active: row[5] === true || String(row[5]).toUpperCase() === 'TRUE',
        displayOrder: Number(row[6] || 999)
      };
    })
    .filter(function(product) {
      return product.id && product.name && product.price > 0 && product.active;
    })
    .sort(function(a, b) {
      return a.displayOrder - b.displayOrder;
    });
}

function getProductById_(ss, productId) {
  const products = getActiveProducts_(ss);
  const target = String(productId || '').trim().toLowerCase();

  for (let i = 0; i < products.length; i++) {
    if (String(products[i].id).toLowerCase() === target) {
      return products[i];
    }
  }

  return null;
}

/***************
 * TERMS
 ***************/
function listTerms_() {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);
  const terms = getActiveTerms_(ss);

  if (!terms || !terms.version || !terms.contentEn || !terms.contentZh) {
    return jsonResponse_({
      success: false,
      error: 'TERMS_UNAVAILABLE'
    });
  }

  return jsonResponse_({
    success: true,
    terms: terms
  });
}

function getActiveTerms_(ss) {
  const sheet = requireSheet_(ss, TERMS_SHEET);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return null;

  const rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const version = String(row[0] || '').trim();
    const active = row[1] === true || String(row[1]).toUpperCase() === 'TRUE';

    if (!version || !active) continue;

    return {
      version: version,
      titleEn: String(row[2] || 'Terms & Conditions and Privacy Notice').trim(),
      contentEn: String(row[3] || '').trim(),
      titleZh: String(row[4] || '注意事項及私隱聲明').trim(),
      contentZh: String(row[5] || '').trim(),
      updatedAt: row[6] instanceof Date ? row[6].toISOString() : String(row[6] || '')
    };
  }

  return null;
}

/***************
 * PROMO
 ***************/
function validatePromo_(payload) {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);

  const product = getProductById_(ss, payload.productId);
  if (!product) {
    return jsonResponse_({
      success: false,
      error: 'INVALID_PRODUCT'
    });
  }

  const result = calculatePromo_(ss, product, payload.promoCode);
  const discount = result.valid ? result.discount : 0;

  return jsonResponse_({
    success: true,
    promo: {
      valid: result.valid,
      code: result.code,
      originalPrice: product.price,
      discount: discount,
      finalPrice: product.price - discount,
      price: product.price - discount,
      message: result.message || ''
    }
  });
}

function calculatePromo_(ss, product, promoCode) {
  const code = String(promoCode || '').trim().toUpperCase();

  if (!code) {
    return {
      valid: false,
      code: '',
      discount: 0,
      message: ''
    };
  }

  const sheet = requireSheet_(ss, PROMOTIONS_SHEET);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return {
      valid: false,
      code: code,
      discount: 0,
      message: 'Invalid promo code'
    };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 10).getValues();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const rowCode = String(row[0] || '').trim().toUpperCase();
    if (rowCode !== code) continue;

    const type = String(row[1] || '').trim().toUpperCase();
    const value = Number(row[2] || 0);
    const active = row[3] === true || String(row[3]).toUpperCase() === 'TRUE';
    const startDate = row[4];
    const endDate = row[5];
    const applicableProducts = String(row[6] || 'ALL').trim();
    const maxUses = Number(row[7] || 0);
    const uses = Number(row[8] || 0);

    if (!active) {
      return { valid: false, code: code, discount: 0, message: 'Promo code inactive' };
    }

    const now = new Date();

    if (startDate instanceof Date && now < startDate) {
      return { valid: false, code: code, discount: 0, message: 'Promo code not started' };
    }

    if (endDate instanceof Date && now > endDate) {
      return { valid: false, code: code, discount: 0, message: 'Promo code expired' };
    }

    if (maxUses > 0 && uses >= maxUses) {
      return { valid: false, code: code, discount: 0, message: 'Promo code limit reached' };
    }

    if (!isPromoApplicable_(applicableProducts, product.id)) {
      return { valid: false, code: code, discount: 0, message: 'Promo code not applicable to this product' };
    }

    let discount = 0;

    if (type === 'PERCENT') {
      discount = Math.round(product.price * value / 100);
    } else if (type === 'FIXED') {
      discount = Math.round(value);
    } else {
      return { valid: false, code: code, discount: 0, message: 'Invalid promo type' };
    }

    discount = Math.max(0, Math.min(discount, product.price));

    return {
      valid: true,
      code: code,
      discount: discount,
      rowNumber: i + 2,
      message: 'Promo applied'
    };
  }

  return {
    valid: false,
    code: code,
    discount: 0,
    message: 'Invalid promo code'
  };
}

function isPromoApplicable_(applicableProducts, productId) {
  const value = String(applicableProducts || '').trim();

  if (!value || value.toUpperCase() === 'ALL') return true;

  const ids = value
    .split(',')
    .map(function(x) { return x.trim().toLowerCase(); })
    .filter(Boolean);

  return ids.indexOf(String(productId || '').toLowerCase()) !== -1;
}

function incrementPromoUse_(ss, promoResult) {
  if (!promoResult || !promoResult.valid || !promoResult.rowNumber) return;

  const sheet = requireSheet_(ss, PROMOTIONS_SHEET);
  const current = Number(sheet.getRange(promoResult.rowNumber, 9).getValue() || 0);
  sheet.getRange(promoResult.rowNumber, 9).setValue(current + 1);
}

/***************
 * ORDER
 ***************/
function createOrder_(payload) {
  const props = getRequiredProperties_();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(props.sheetId);
    const ordersSheet = requireSheet_(ss, ORDERS_SHEET);
    ensureOrderColumns_(ordersSheet);

    const requestId = String(payload.requestId || '').trim();
    if (!requestId) throw new Error('MISSING_REQUEST_ID');

    const existing = findOrderByRequestId_(ordersSheet, requestId);
    if (existing) {
      return jsonResponse_({
        success: true,
        orderNumber: existing.orderNumber,
        orderToken: deriveOrderToken_(requestId),
        duplicate: true
      });
    }

    const product = getProductById_(ss, payload.productId);
    if (!product) throw new Error('INVALID_PRODUCT');

    const terms = getActiveTerms_(ss);
    if (!terms) throw new Error('TERMS_UNAVAILABLE');

    const acceptedTermsVersion = String(payload.termsVersion || '').trim();
    if (!acceptedTermsVersion || acceptedTermsVersion !== terms.version) {
      throw new Error('TERMS_NOT_ACCEPTED');
    }

    const outline = normalizeOutline_(payload.outline);
    const customer = normalizeCustomerPayload_(payload);

    if (!payload.firstPhoto || !payload.firstPhoto.data) {
      throw new Error('MISSING_FIRST_PHOTO');
    }

    const firstPhotoBlob = decodeAndValidateImage_(payload.firstPhoto.data, 'PET_01');

    const promoResult = calculatePromo_(ss, product, payload.promoCode);
    const discount = promoResult.valid ? promoResult.discount : 0;
    const finalPrice = product.price - discount;

    const orderNumber = generateSequentialOrderNumber_(ordersSheet);
    const orderToken = deriveOrderToken_(requestId);
    const orderTokenHash = sha256Hex_(orderToken);

    const folder = DriveApp.getFolderById(props.folderId).createFolder(orderNumber);
    folder.createFile(firstPhotoBlob);

    const folderUrl = folder.getUrl();
    const folderFormula = '=HYPERLINK("' + folderUrl + '","' + orderNumber + '")';

    const rowValues = [
      orderNumber,
      new Date(),
      safeText_(customer.instagram),
      safeText_(customer.name),
      safeText_(customer.phone),
      safeText_(customer.address),
      safeText_(product.name),
      safeText_(product.dims),
      finalPrice,
      safeText_(payload.notes || ''),
      '',
      ORDER_STATUS_AWAITING_PROOF,
      orderTokenHash,
      requestId,
      new Date(),
      terms.version,
      promoResult.valid ? promoResult.code : '',
      product.price,
      discount,
      outline
    ];

    ordersSheet.appendRow(rowValues);

    const lastRow = ordersSheet.getLastRow();
    ordersSheet.getRange(lastRow, 11).setFormula(folderFormula);

    if (promoResult.valid) {
      incrementPromoUse_(ss, promoResult);
    }

    try {
      syncOrderToFinanceSheet_({
        orderNumber: orderNumber,
        instagram: safeText_(customer.instagram),
        name: safeText_(customer.name),
        phone: safeText_(customer.phone),
        address: safeText_(customer.address),
        productName: product.name,
        promoCode: promoResult.valid ? promoResult.code : '',
        outline: outline
      });
    } catch (financeErr) {
      logSecurity_('FINANCE_SYNC_FAILED', orderNumber, String(financeErr.message || financeErr));
    }

    logSecurity_('ORDER_CREATED', orderNumber, 'Order created');

    return jsonResponse_({
      success: true,
      orderNumber: orderNumber,
      orderToken: orderToken,
      product: product,
      price: finalPrice,
      finalPrice: finalPrice,
      total: finalPrice,
      amount: finalPrice,
      originalPrice: product.price,
      discount: discount,
      promoCode: promoResult.valid ? promoResult.code : '',
      outline: outline,
      termsVersion: terms.version
    });

  } finally {
    lock.releaseLock();
  }
}

function ensureOrderColumns_(sheet) {
  const headers = [
    'Order #',
    'Date',
    'Instagram',
    'Name',
    'Phone',
    'Address',
    'Size',
    'Dims',
    'Price',
    'Notes',
    'Folder',
    'Payment Status',
    'Payment Token Hash',
    'Request ID',
    'Terms Accepted At',
    'Terms Version',
    'Promo Code',
    'Original Price',
    'Discount',
    'Outline'
  ];

  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];

  for (let i = 0; i < headers.length; i++) {
    if (!existing[i]) {
      sheet.getRange(1, i + 1).setValue(headers[i]);
    }
  }
}

function findOrderByRequestId_(sheet, requestId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][13] || '').trim() === requestId) {
      return {
        row: i + 2,
        orderNumber: String(data[i][0] || '')
      };
    }
  }

  return null;
}

function generateSequentialOrderNumber_(sheet) {
  const year = Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'yyyy');
  const prefix = 'MEOW-' + year + '-';

  const lastRow = sheet.getLastRow();
  let max = 0;

  if (lastRow >= 2) {
    const orderNumbers = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    orderNumbers.forEach(function(row) {
      const value = String(row[0] || '');

      if (value.indexOf(prefix) === 0) {
        const n = Number(value.replace(prefix, ''));
        if (n > max) max = n;
      }
    });
  }

  const next = max + 1;
  return prefix + String(next).padStart(4, '0');
}

function normalizeOutline_(value) {
  const v = String(value || '').trim().toLowerCase();

  if (v === 'black' || v === 'black outline') return 'Black outline';
  if (v === 'white' || v === 'white outline') return 'White outline';

  throw new Error('INVALID_OUTLINE');
}

function normalizeCustomerPayload_(payload) {
  return {
    instagram: firstText_([
      payload.instagram,
      payload.ig,
      payload.instagramHandle,
      payload.customer && payload.customer.instagram
    ]),
    name: firstText_([
      payload.name,
      payload.fullName,
      payload.customerName,
      payload.customer && payload.customer.name,
      payload.customer && payload.customer.fullName
    ]),
    phone: firstText_([
      payload.phone,
      payload.phoneNumber,
      payload.mobile,
      payload.customer && payload.customer.phone
    ]),
    address: firstText_([
      payload.address,
      payload.deliveryAddress,
      payload.shippingAddress,
      payload.fullAddress,
      payload.sfAddress,
      payload.sfLocationAddress,
      payload.lockerAddress,
      payload.delivery && payload.delivery.address,
      payload.shipping && payload.shipping.address,
      payload.customer && payload.customer.address
    ])
  };
}

function firstText_(values) {
  for (let i = 0; i < values.length; i++) {
    const value = String(values[i] || '').trim();
    if (value) return value;
  }
  return '';
}

function deriveOrderToken_(requestId) {
  const props = getRequiredProperties_();
  return sha256Hex_(props.apiSecret + '|' + String(requestId || ''));
}

/***************
 * MANAGE ORDER
 ***************/
function manageOrderLookup_(payload) {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);
  const ordersSheet = requireSheet_(ss, ORDERS_SHEET);

  const orderNumber = String(payload.orderNumber || '').trim();
  const phone = String(payload.phone || '').trim();

  if (!orderNumber) throw new Error('MISSING_ORDER_NUMBER');
  if (!phone) throw new Error('MISSING_PHONE');

  const order = findOrderByNumber_(ordersSheet, orderNumber);
  if (!order) throw new Error('ORDER_NOT_FOUND');

  if (normalizePhone_(order.phone) !== normalizePhone_(phone)) {
    logSecurity_('MANAGE_LOOKUP_FAILED', orderNumber, 'Invalid phone verification');
    throw new Error('INVALID_ORDER_DETAILS');
  }

  if (!order.requestId) {
    throw new Error('ORDER_CANNOT_BE_MANAGED');
  }

  const orderToken = deriveOrderToken_(order.requestId);
  verifyOrderToken_(order, orderToken);

  logSecurity_('MANAGE_LOOKUP_SUCCESS', orderNumber, 'Customer verified order management access');

  return jsonResponse_({
    success: true,
    orderNumber: order.orderNumber,
    orderToken: orderToken,
    order: {
      orderNumber: order.orderNumber,
      instagram: order.instagram,
      name: order.name,
      phone: maskPhone_(order.phone),
      productName: order.productName,
      dims: order.dims,
      price: order.price,
      paymentStatus: order.paymentStatus,
      promoCode: order.promoCode,
      outline: order.outline
    }
  });
}

function normalizePhone_(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function maskPhone_(value) {
  const digits = normalizePhone_(value);
  if (digits.length <= 4) return digits;
  return '••••' + digits.slice(-4);
}

/***************
 * PET PHOTO
 ***************/
function uploadPetPhoto_(payload) {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);
  const ordersSheet = requireSheet_(ss, ORDERS_SHEET);

  const orderNumber = String(payload.orderNumber || '').trim();
  const orderToken = String(payload.orderToken || '').trim();

  const order = findOrderByNumber_(ordersSheet, orderNumber);
  if (!order) throw new Error('ORDER_NOT_FOUND');

  verifyOrderToken_(order, orderToken);

  const photo = payload.photo;
  const index = Number(payload.index || 1);

  if (!photo || !photo.data) throw new Error('MISSING_PHOTO');
  if (index < 1 || index > MAX_PET_PHOTOS) throw new Error('INVALID_PHOTO_INDEX');

  const blob = decodeAndValidateImage_(photo.data, 'PET_' + String(index).padStart(2, '0'));

  const folder = getOrderFolder_(props.folderId, orderNumber);
  folder.createFile(blob);

  logSecurity_('PET_PHOTO_UPLOADED', orderNumber, 'Photo uploaded');

  return jsonResponse_({
    success: true
  });
}

/***************
 * PAYMENT
 ***************/
function submitPayment_(payload) {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);

  const ordersSheet = requireSheet_(ss, ORDERS_SHEET);
  const paymentsSheet = requireSheet_(ss, PAYMENTS_SHEET);

  const orderNumber = String(payload.orderNumber || '').trim();
  const orderToken = String(payload.orderToken || '').trim();

  const order = findOrderByNumber_(ordersSheet, orderNumber);
  if (!order) throw new Error('ORDER_NOT_FOUND');

  verifyOrderToken_(order, orderToken);

  const screenshot = payload.screenshot;
  if (!screenshot || !screenshot.data) throw new Error('MISSING_PAYMENT_SCREENSHOT');

  const blob = decodeAndValidateImage_(screenshot.data, 'PAYMENT_PROOF_' + orderNumber);

  const folder = getOrderFolder_(props.folderId, orderNumber);
  folder.createFile(blob);

  paymentsSheet.appendRow([
    new Date(),
    orderNumber,
    'FPS',
    PAYMENT_STATUS_PROOF_SUBMITTED,
    'proof',
    '',
    safeText_(screenshot.name || 'payment-proof'),
    'web'
  ]);

  ordersSheet.getRange(order.row, 12).setValue(PAYMENT_STATUS_PROOF_SUBMITTED);

  logSecurity_('PAYMENT_PROOF_SUBMITTED', orderNumber, 'Payment proof submitted');

  return jsonResponse_({
    success: true,
    message: 'Payment proof submitted'
  });
}

/***************
 * ORDER HELPERS
 ***************/
function findOrderByNumber_(sheet, orderNumber) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === orderNumber) {
      return {
        row: i + 2,
        orderNumber: String(data[i][0] || '').trim(),
        date: data[i][1],
        instagram: String(data[i][2] || '').trim(),
        name: String(data[i][3] || '').trim(),
        phone: String(data[i][4] || '').trim(),
        address: String(data[i][5] || '').trim(),
        productName: String(data[i][6] || '').trim(),
        dims: String(data[i][7] || '').trim(),
        price: Number(data[i][8] || 0),
        paymentStatus: String(data[i][11] || '').trim(),
        tokenHash: String(data[i][12] || '').trim(),
        requestId: String(data[i][13] || '').trim(),
        termsVersion: String(data[i][15] || '').trim(),
        promoCode: String(data[i][16] || '').trim(),
        originalPrice: Number(data[i][17] || 0),
        discount: Number(data[i][18] || 0),
        outline: String(data[i][19] || '').trim()
      };
    }
  }

  return null;
}

function verifyOrderToken_(order, token) {
  if (!token || !order.tokenHash) {
    throw new Error('INVALID_ORDER_TOKEN');
  }

  const hash = sha256Hex_(token);

  if (hash !== order.tokenHash) {
    throw new Error('INVALID_ORDER_TOKEN');
  }
}

function getOrderFolder_(parentFolderId, orderNumber) {
  const parent = DriveApp.getFolderById(parentFolderId);
  const folders = parent.getFoldersByName(orderNumber);

  if (!folders.hasNext()) {
    return parent.createFolder(orderNumber);
  }

  return folders.next();
}

/***************
 * IMAGE HANDLING
 ***************/
function decodeAndValidateImage_(data, fallbackName) {
  const rawData = String(data || '');
  const base64 = rawData.indexOf(',') >= 0 ? rawData.split(',')[1] : rawData;

  if (!base64) {
    throw new Error('MISSING_IMAGE_DATA');
  }

  const bytes = Utilities.base64Decode(base64);

  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('IMAGE_TOO_LARGE');
  }

  const imageInfo = detectImageType_(bytes);

  if (!imageInfo) {
    throw new Error('INVALID_IMAGE_TYPE');
  }

  return Utilities.newBlob(bytes, imageInfo.mimeType, fallbackName + imageInfo.extension);
}

function detectImageType_(bytes) {
  if (!bytes || bytes.length < 8) return null;

  const b0 = bytes[0] & 255;
  const b1 = bytes[1] & 255;
  const b2 = bytes[2] & 255;
  const b3 = bytes[3] & 255;
  const b4 = bytes[4] & 255;
  const b5 = bytes[5] & 255;
  const b6 = bytes[6] & 255;
  const b7 = bytes[7] & 255;

  const isJpg = b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF;
  if (isJpg) {
    return {
      mimeType: 'image/jpeg',
      extension: '.jpg'
    };
  }

  const isPng =
    b0 === 0x89 &&
    b1 === 0x50 &&
    b2 === 0x4E &&
    b3 === 0x47 &&
    b4 === 0x0D &&
    b5 === 0x0A &&
    b6 === 0x1A &&
    b7 === 0x0A;

  if (isPng) {
    return {
      mimeType: 'image/png',
      extension: '.png'
    };
  }

  return null;
}

/***************
 * FINANCE SYNC
 ***************/
function getFinanceSheet_() {
  const ss = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID);

  const selectedSheetName = getFinanceSetting_(ss, FINANCE_ACTIVE_SHEET_KEY);
  const availableSheetNames = getAvailableFinanceSheetNames_(ss);

  if (selectedSheetName) {
    const matchedName = findSheetNameLoose_(availableSheetNames, selectedSheetName);

    if (!matchedName) {
      throw new Error(
        'Selected finance sheet not found or not valid: ' +
        selectedSheetName +
        '. Please choose from Settings dropdown.'
      );
    }

    const selectedSheet = ss.getSheetByName(matchedName);
    if (selectedSheet) return selectedSheet;
  }

  const defaultMatchedName = findSheetNameLoose_(availableSheetNames, DEFAULT_SHEET_NAME);
  if (defaultMatchedName) {
    return ss.getSheetByName(defaultMatchedName);
  }

  if (availableSheetNames.length > 0) {
    return ss.getSheetByName(availableSheetNames[0]);
  }

  throw new Error('No available finance sheet found. Please check finance sheet headers.');
}

function getFinanceSetting_(ss, key) {
  const sheet = ss.getSheetByName(FINANCE_SETTINGS_SHEET);
  if (!sheet) return '';

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';

  // Use display values so date-formatted cells do not break reading.
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues();
  const target = String(key || '').trim();

  for (let i = 0; i < values.length; i++) {
    const rowKey = String(values[i][0] || '').trim();
    const rowValue = String(values[i][1] || '').trim();

    if (rowKey === target) {
      return rowValue;
    }
  }

  return '';
}

function setupFinanceSettingsSheet() {
  const ss = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID);

  let sheet = ss.getSheetByName(FINANCE_SETTINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(FINANCE_SETTINGS_SHEET);
  }

  sheet.clear();

  sheet.getRange(1, 1, 1, 2).setValues([[
    'Key',
    'Value'
  ]]);

  sheet.getRange(2, 1).setValue(FINANCE_ACTIVE_SHEET_KEY);

  // Force B2 to plain text, so values like Jun-2026 / Jun 2026 do not become dates.
  sheet.getRange(2, 2).setNumberFormat('@');

  const availableSheetNames = getAvailableFinanceSheetNames_(ss);

  if (availableSheetNames.length === 0) {
    throw new Error('No available finance sheets found. Check headers: For Delivery / Instagram / Full Name / Phone / Address and RUG MAKING COST.');
  }

  const defaultName =
    availableSheetNames.indexOf(DEFAULT_SHEET_NAME) !== -1
      ? DEFAULT_SHEET_NAME
      : availableSheetNames[0];

  sheet.getRange(2, 2).setValue(defaultName);
  applyFinanceSheetDropdown_(sheet, availableSheetNames);

  sheet.setFrozenRows(1);

  sheet.getRange(1, 1, 1, 2)
    .setFontWeight('bold')
    .setBackground('#111111')
    .setFontColor('#ffffff');

  sheet.setColumnWidth(1, 240);
  sheet.setColumnWidth(2, 260);

  console.log('Finance Settings sheet ready. Selected: ' + defaultName);
  console.log('Available finance sheets: ' + availableSheetNames.join(', '));
}

function refreshFinanceSettingsDropdown() {
  const ss = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(FINANCE_SETTINGS_SHEET);

  if (!sheet) {
    setupFinanceSettingsSheet();
    return;
  }

  const availableSheetNames = getAvailableFinanceSheetNames_(ss);

  if (availableSheetNames.length === 0) {
    throw new Error('No available finance sheets found.');
  }

  sheet.getRange(1, 1, 1, 2).setValues([[
    'Key',
    'Value'
  ]]);

  sheet.getRange(2, 1).setValue(FINANCE_ACTIVE_SHEET_KEY);
  sheet.getRange(2, 2).setNumberFormat('@');

  const currentValue = String(sheet.getRange(2, 2).getDisplayValue() || '').trim();
  const matchedSheet = findSheetNameLoose_(availableSheetNames, currentValue);

  const selectedName = matchedSheet ||
    (availableSheetNames.indexOf(DEFAULT_SHEET_NAME) !== -1 ? DEFAULT_SHEET_NAME : availableSheetNames[0]);

  sheet.getRange(2, 2).setValue(selectedName);
  applyFinanceSheetDropdown_(sheet, availableSheetNames);

  sheet.setFrozenRows(1);

  sheet.getRange(1, 1, 1, 2)
    .setFontWeight('bold')
    .setBackground('#111111')
    .setFontColor('#ffffff');

  sheet.setColumnWidth(1, 240);
  sheet.setColumnWidth(2, 260);

  console.log('Finance Settings dropdown refreshed. Selected: ' + selectedName);
  console.log('Available finance sheets: ' + availableSheetNames.join(', '));
}

function applyFinanceSheetDropdown_(settingsSheet, availableSheetNames) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(availableSheetNames, true)
    .setAllowInvalid(false)
    .build();

  settingsSheet.getRange(2, 2).setDataValidation(rule);
}

function getAvailableFinanceSheetNames_(ss) {
  const sheets = ss.getSheets();
  const names = [];

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const name = sheet.getName();

    if (name === FINANCE_SETTINGS_SHEET) continue;

    if (isValidFinanceSheet_(sheet)) {
      names.push(name);
    }
  }

  return names;
}

function isValidFinanceSheet_(sheet) {
  try {
    getFinanceDeliveryColumns_(sheet);
    findFinanceCostRow_(sheet);
    return true;
  } catch (_) {
    return false;
  }
}

function findSheetNameLoose_(availableSheetNames, inputName) {
  const target = normalizeSheetName_(inputName);
  if (!target) return '';

  for (let i = 0; i < availableSheetNames.length; i++) {
    if (normalizeSheetName_(availableSheetNames[i]) === target) {
      return availableSheetNames[i];
    }
  }

  return '';
}

function normalizeSheetName_(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .trim()
    .toUpperCase();
}

function syncOrderToFinanceSheet_(order) {
  const sheet = getFinanceSheet_();

  let row = findFinanceOrderRow_(sheet, order.orderNumber);

  if (!row) {
    const costRow = findFinanceCostRow_(sheet);
    const insertRow = findFinanceInsertRow_(sheet, costRow);

    if (insertRow >= costRow) {
      sheet.insertRowBefore(costRow);
      row = costRow;
    } else {
      row = insertRow;
    }

    const templateRow = Math.max(5, row - 1);
    const lastCol = sheet.getLastColumn();

    sheet
      .getRange(templateRow, 1, 1, lastCol)
      .copyTo(sheet.getRange(row, 1, 1, lastCol), { formatOnly: false });
  }

  writeFinanceOrderRow_(sheet, row, order);
}

function findFinanceOrderRow_(sheet, orderNumber) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 5) return null;

  const target = String(orderNumber || '').trim();
  if (!target) return null;

  const values = sheet.getRange(5, 4, lastRow - 4, 1).getValues();

  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === target) {
      return i + 5;
    }
  }

  return null;
}

function writeFinanceOrderRow_(sheet, row, order) {
  const deliveryCols = getFinanceDeliveryColumns_(sheet);

  // Main finance table. These columns are your fixed finance input columns.
  sheet.getRange(row, 3).setValue(new Date());
  sheet.getRange(row, 4).setValue(safeText_(order.orderNumber));
  sheet.getRange(row, 5).setValue(safeText_(order.instagram));
  sheet.getRange(row, 7).setValue(mapFinanceProductName_(order.productName, order.promoCode));
  sheet.getRange(row, 8).setValue(mapFinanceOutline_(order.outline));
  sheet.getRange(row, 9).setValue(1);
  sheet.getRange(row, 10).setValue('FPS');

  // Delivery table. These are found by header name, so columns can move.
  sheet.getRange(row, deliveryCols.forDelivery).setValue(safeText_(order.orderNumber));
  sheet.getRange(row, deliveryCols.instagram).setValue(safeText_(order.instagram));
  sheet.getRange(row, deliveryCols.fullName).setValue(safeText_(order.name));
  sheet.getRange(row, deliveryCols.phone).setValue(safeText_(order.phone));
  sheet.getRange(row, deliveryCols.address).setValue(safeText_(order.address));
}

function getFinanceDeliveryColumns_(sheet) {
  const lastCol = sheet.getLastColumn();
  const maxHeaderRows = Math.min(10, sheet.getLastRow());
  const values = sheet.getRange(1, 1, maxHeaderRows, lastCol).getDisplayValues();

  for (let r = 0; r < values.length; r++) {
    const row = values[r];

    const forDelivery = findHeaderColInRow_(row, 'For Delivery');
    const instagram = findHeaderColInRow_(row, 'Instagram');
    const fullName = findHeaderColInRow_(row, 'Full Name');
    const phone = findHeaderColInRow_(row, 'Phone');
    const address = findHeaderColInRow_(row, 'Address');

    if (forDelivery && instagram && fullName && phone && address) {
      return {
        forDelivery: forDelivery,
        instagram: instagram,
        fullName: fullName,
        phone: phone,
        address: address
      };
    }
  }

  throw new Error('Finance delivery headers not found: For Delivery / Instagram / Full Name / Phone / Address');
}

function findHeaderColInRow_(rowValues, headerName) {
  const target = normalizeHeader_(headerName);

  for (let i = 0; i < rowValues.length; i++) {
    if (normalizeHeader_(rowValues[i]) === target) {
      return i + 1;
    }
  }

  return null;
}

function normalizeHeader_(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

function mapFinanceOutline_(outline) {
  const v = String(outline || '').trim().toLowerCase();

  if (v === 'black' || v === 'black outline') return 'Black';
  if (v === 'white' || v === 'white outline') return 'White';

  // Finance column H has data validation, so leave blank instead of writing an invalid value.
  return '';
}

function financeOrderExists_(sheet, orderNumber) {
  return !!findFinanceOrderRow_(sheet, orderNumber);
}

function findFinanceCostRow_(sheet) {
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();

  for (let r = 0; r < values.length; r++) {
    const joined = values[r].join(' ').replace(/\s+/g, '').toUpperCase();

    if (joined.indexOf('RUGMAKINGCOST') >= 0) {
      return r + 1;
    }
  }

  throw new Error('找不到 RUG MAKING COST 行');
}

function findFinanceInsertRow_(sheet, costRow) {
  for (let r = 5; r < costRow; r++) {
    const orderNo = String(sheet.getRange(r, 4).getValue() || '').trim();
    const product = String(sheet.getRange(r, 7).getValue() || '').trim();

    if (!orderNo && !product) {
      return r;
    }
  }

  return costRow;
}

function mapFinanceProductName_(productName, promoCode) {
  const name = String(productName || '').trim();
  const has10 = String(promoCode || '').trim().toUpperCase() === 'MEOW10';

  const baseMap = {
    'S': 'S',
    'M': 'M',
    'L': 'L',
    'S - Oval': 'Oval - S',
    'M - Oval': 'Oval - M',
    'L - Oval': 'Oval - L',
    'Mini Rug': '20cm Mini Rug',
    'Coaster': '15cm Coaster'
  };

  const mapped = baseMap[name] || name;

  if (has10 && mapped === 'S') return 'S (10% off)';
  if (has10 && mapped === 'M') return 'M (10% off)';
  if (has10 && mapped === 'L') return 'L (10% off)';

  return mapped;
}

function testFinanceSyncAccess() {
  const sheet = getFinanceSheet_();

  findFinanceCostRow_(sheet);
  getFinanceDeliveryColumns_(sheet);

  console.log('Finance sync access OK: ' + sheet.getName());
}

function debugFinanceSyncTarget() {
  const sheet = getFinanceSheet_();

  console.log('Selected finance sheet: ' + sheet.getName());
  console.log('Last row: ' + sheet.getLastRow());
  console.log('Last column: ' + sheet.getLastColumn());

  const deliveryCols = getFinanceDeliveryColumns_(sheet);
  console.log('Delivery columns: ' + JSON.stringify(deliveryCols));

  const costRow = findFinanceCostRow_(sheet);
  console.log('RUG MAKING COST row: ' + costRow);
}

function testWriteFinanceOneOrder() {
  syncOrderToFinanceSheet_({
    orderNumber: 'TEST-SYNC-001',
    instagram: '@test',
    name: 'Test Name',
    phone: '12345678',
    address: 'Test Address',
    productName: 'S',
    promoCode: '',
    outline: 'Black outline'
  });

  console.log('Test order synced');
}

function resyncFinanceDeliveryFromOrders() {
  const props = getRequiredProperties_();
  const orderSS = SpreadsheetApp.openById(props.sheetId);
  const ordersSheet = requireSheet_(orderSS, ORDERS_SHEET);

  const lastRow = ordersSheet.getLastRow();
  if (lastRow < 2) return;

  const rows = ordersSheet.getRange(2, 1, lastRow - 1, 20).getValues();

  rows.forEach(function(row) {
    const orderNumber = String(row[0] || '').trim();
    if (!orderNumber) return;

    syncOrderToFinanceSheet_({
      orderNumber: orderNumber,
      instagram: row[2],
      name: row[3],
      phone: row[4],
      address: row[5],
      productName: row[6],
      promoCode: row[16],
      outline: row[19]
    });
  });

  console.log('Finance delivery columns resynced from Orders');
}

/***************
 * SETUP SHEETS
 ***************/
function setupProductsSheet() {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);

  let sheet = ss.getSheetByName(PRODUCTS_SHEET);
  if (!sheet) sheet = ss.insertSheet(PRODUCTS_SHEET);

  sheet.clear();

  sheet.getRange(1, 1, 1, 7).setValues([[
    'Product ID',
    'Product Name',
    'Dimensions',
    'Price',
    'Capacity',
    'Active',
    'Display Order'
  ]]);

  const products = [
    ['s', 'S', '70 × 30-40 cm', 590, '1 person + 1 pet', true, 1],
    ['m', 'M', '100 × 40-50 cm', 690, '2 people + 1-2 pets', true, 2],
    ['l', 'L', '130 × 50-60 cm', 990, '2+ people + 3+ pets', true, 3],
    ['s-oval', 'S - Oval', '70 × 30-40 cm', 590, 'up to 6 heads', true, 4],
    ['m-oval', 'M - Oval', '100 × 40-50 cm', 690, 'up to 8 heads', true, 5],
    ['l-oval', 'L - Oval', '130 × 50-60 cm', 990, 'up to 10 heads', true, 6],
    ['mini', 'Mini Rug', '20 cm', 350, '1 pet', true, 7],
    ['coaster', 'Coaster', '15 cm', 300, '1 pet', true, 8]
  ];

  sheet.getRange(2, 1, products.length, 7).setValues(products);

  sheet.getRange('F2:F1000')
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireCheckbox()
        .build()
    );

  console.log('Products sheet ready');
}

function setupPromotionsSheet() {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);

  let sheet = ss.getSheetByName(PROMOTIONS_SHEET);
  if (!sheet) sheet = ss.insertSheet(PROMOTIONS_SHEET);

  sheet.clear();

  sheet.getRange(1, 1, 1, 10).setValues([[
    'Code',
    'Discount Type',
    'Discount Value',
    'Active',
    'Start Date',
    'End Date',
    'Applicable Products',
    'Max Uses',
    'Uses',
    'Notes'
  ]]);

  sheet.appendRow([
    'MEOW10',
    'PERCENT',
    10,
    true,
    '',
    '',
    'ALL',
    '',
    0,
    '10% off'
  ]);

  sheet.getRange('D2:D1000')
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireCheckbox()
        .build()
    );

  console.log('Promotions sheet ready');
}

function setupTermsSheet() {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);

  let sheet = ss.getSheetByName(TERMS_SHEET);
  if (!sheet) sheet = ss.insertSheet(TERMS_SHEET);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 7).setValues([[
      'Version',
      'Active',
      'Title EN',
      'Content EN',
      'Title ZH',
      'Content ZH',
      'Updated At'
    ]]);
  }

  sheet.setFrozenRows(1);

  sheet.getRange(1, 1, 1, 7)
    .setFontWeight('bold')
    .setBackground('#111111')
    .setFontColor('#ffffff');

  sheet.getRange('B2:B1000')
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireCheckbox()
        .build()
    );

  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 260);
  sheet.setColumnWidth(4, 600);
  sheet.setColumnWidth(5, 220);
  sheet.setColumnWidth(6, 600);
  sheet.setColumnWidth(7, 160);

  sheet.getRange('D:D').setWrap(true);
  sheet.getRange('F:F').setWrap(true);

  if (sheet.getLastRow() < 2) {
    sheet.appendRow([
      '2026-06-24-v1',
      true,
      'Terms & Conditions and Privacy Notice',
      'Please paste the English terms here.',
      '注意事項及私隱聲明',
      '請在此貼上中文條款。',
      new Date()
    ]);
  }

  console.log('Terms sheet ready');
}

/***************
 * TESTS
 ***************/
function testConfiguration() {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);

  [
    ORDERS_SHEET,
    PAYMENTS_SHEET,
    SECURITY_LOGS_SHEET,
    PROMOTIONS_SHEET,
    PRODUCTS_SHEET,
    TERMS_SHEET
  ].forEach(function(name) {
    requireSheet_(ss, name);
  });

  DriveApp.getFolderById(props.folderId);

  const terms = getActiveTerms_(ss);
  if (!terms || !terms.version || !terms.contentEn || !terms.contentZh) {
    throw new Error('Terms sheet has no active complete version');
  }

  console.log('Secure backend configuration OK');
}

/***************
 * UTILITIES
 ***************/
function requireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);

  if (!sheet) {
    throw new Error('Missing sheet: ' + name);
  }

  return sheet;
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeText_(value) {
  let text = String(value || '').trim();

  if (/^[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return text;
}

function sha256Hex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );

  return bytes.map(function(byte) {
    const v = (byte + 256) % 256;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function logSecurity_(eventType, orderNumber, message) {
  const props = getRequiredProperties_();
  const ss = SpreadsheetApp.openById(props.sheetId);
  const sheet = requireSheet_(ss, SECURITY_LOGS_SHEET);

  sheet.appendRow([
    new Date(),
    eventType,
    '',
    orderNumber || '',
    message || ''
  ]);
}
