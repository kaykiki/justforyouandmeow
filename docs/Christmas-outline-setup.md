# Christmas products: optional outline

The website is prepared to hide Outline colour only when Apps Script reports `requiresOutline: false`. This keeps orders working until the backend is updated.

These changes are based on the `order_code.gs` you provided on 14 September. Apply only the indicated edits to your CURRENT order Apps Script. Keep your current Finance formula and other code.

## 1. Add this helper once

Paste this outside any other function:

```javascript
function noOutlineProduct_(product) {
  return [product && product.id, product && product.name].some(function(value) {
    const text = String(value || '').trim().toLowerCase()
      .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    return text === 'christmas ornament' || text === 'christmas wreath';
  });
}
```

## 2. Change the outline validation call in createOrder_

Find:

```javascript
const outline = normalizeOutline_(payload.outline);
```

Replace with:

```javascript
const outline = normalizeOutline_(payload.outline, orderItems);
```

`orderItems` must be the result of the existing `normalizeOrderItems_(ss, payload)` call, so product details come from your Products sheet.

## 3. Replace normalizeOutline_

Replace the existing function with:

```javascript
function normalizeOutline_(value, orderItems) {
  if (Array.isArray(orderItems) && orderItems.length &&
      orderItems.every(function(item) { return noOutlineProduct_(item.product); })) {
    return '';
  }
  const v = String(value || '').trim().toLowerCase();
  if (v === 'black' || v === 'black outline') return 'Black outline';
  if (v === 'white' || v === 'white outline') return 'White outline';
  throw new Error('INVALID_OUTLINE');
}
```

This permits a blank outline only for orders consisting entirely of the two Christmas products. Other and mixed orders still require Black or White.

## 4. Enable the website in listProducts_

Inside `listProducts_()`, find:

```javascript
products: products
```

Replace with:

```javascript
products: products.map(function(product) {
  return Object.assign({}, product, {
    requiresOutline: !noOutlineProduct_(product)
  });
})
```

## 5. Leave Christmas product outline cells blank in Finance

Find:

```javascript
.setValue(currentLine.isDigitalCopy ? '' : mapFinanceOutline_(order.outline));
```

Replace with:

```javascript
.setValue(
  currentLine.isDigitalCopy ||
  noOutlineProduct_({ name: currentLine.productName })
    ? '' : mapFinanceOutline_(order.outline)
);
```

This also leaves the Christmas rows blank in a mixed order; the rug rows retain the chosen outline.

## 6. Save and deploy

1. Save the order Apps Script.
2. Deploy → Manage deployments → select the existing Web app → Edit.
3. Select New version, then Deploy. Keep the existing Web app URL.
4. Refresh the website.

Expected behavior:
- Christmas Ornament only, Christmas Wreath only, or both: Outline colour hides and Continue proceeds without choosing an outline.
- Any other product in the order: Outline colour remains required.
- Christmas Finance rows: Outline stays blank.
- No existing orders are backfilled or changed.

If the expected code is missing or differs, use your latest Code.gs for the edit rather than replacing the entire project with the September copy.
