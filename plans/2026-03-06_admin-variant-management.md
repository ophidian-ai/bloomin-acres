# Plan: Admin Variant Management on Product Pages

**Date:** 2026-03-06

## Context

The admin wants to control which product variants are visible to customers, track inventory quantities, and reorder variants via drag-and-drop. Currently, all variants are always shown to customers with no availability toggle, no inventory count, and no way to reorder them.

## Files to Modify

- **product.html** — Admin edit panel (variation rows), customer variation pills, save logic
- **css/product.css** — Styles for new UI elements (drag handle, checkbox, quantity, drag states)
- **menu.html** — Filter hidden variants from customer dropdown (line ~356-386)

## Changes

### 1. CSS — Add new styles to `css/product.css`

- `.variation-drag-handle` — 6-dot grip icon, `cursor: grab`
- `.variation-available-check` — Checkbox styled with sage-green accent
- `.variation-qty-wrap` / `.variation-qty-label` / `.variation-qty-input` — Compact quantity counter
- `.variation-row-dragging` — Dimmed opacity during drag
- `.drag-over-above` / `.drag-over-below` — Drop target indicator borders
- `.variation-row-unavailable` — Dimmed row when unchecked
- Update `.variation-row` to add padding and border transition for drag feedback

### 2. product.html — Admin Variation Row Template (~line 188-196)

Expand each variation row to include (left to right):

1. **Drag handle** (grip icon)
2. **Availability checkbox** (checked = visible to customers, defaults to checked)
3. **Name input** (existing)
4. **Price delta input** (existing)
5. **Quantity input** (inventory count)
6. **Remove button** (existing)

### 3. product.html — Update `addVariationRow()` (~line 329)

- Accept new params: `available` (default `true`), `quantity` (default `0`)
- Match the updated row template from step 2
- Wire drag handle events and checkbox change listener

### 4. product.html — Update Save Handler (~line 396-401)

Collect `available` (checkbox `.checked`) and `quantity` (parsed int) from each row and include in the saved variations JSONB array:

```json
[{ "name": "...", "price_delta": 0, "available": true, "quantity": 5 }]
```

### 5. product.html — Filter Customer Variation Pills (~line 167)

- Filter: `variations.filter(v => v.available !== false && (v.quantity === undefined || v.quantity > 0))`
  - Backward-compatible with old data (missing `available` = shown, missing `quantity` = shown)
  - Variants with `quantity === 0` are automatically hidden from customers (no "Sold out" state)
- Show stock count on pills when quantity is low (e.g. `(3 left)` when <= 5)

### 6. product.html — Drag-and-Drop Reordering (new functions)

- **Desktop:** HTML5 Drag and Drop API on `#variations-list`, triggered only from drag handle (mousedown/mouseup toggle `draggable` attribute)
- **Mobile:** Touch event listeners (`touchstart`/`touchmove`/`touchend`) on drag handle for reordering
- DOM order = saved order (naturally captured in save handler)

### 7. product.html — Checkbox Visual Feedback

- Wire `change` listener on each `.variation-available-check`
- Toggle `.variation-row-unavailable` class to dim unchecked rows

### 8. menu.html — Filter Variant Dropdown (~line 356-386)

- Add `const availableVariations = variations.filter(v => v.available !== false && (v.quantity === undefined || v.quantity > 0));`
- Use `availableVariations` for dropdown HTML and for the "Options" button visibility check

## Data Model

No SQL migration needed — `product_details.variations` is JSONB. New fields (`available`, `quantity`) are added to the JSON objects. Backward compatibility is handled by defaulting: `v.available !== false` (missing = available) and `v.quantity || 0` (missing = 0).

## Build Sequence

1. Add CSS styles to `css/product.css`
2. Update admin template + `addVariationRow()` + save handler in `product.html`
3. Add drag-and-drop functions + checkbox feedback in `product.html`
4. Add customer-side filtering in `product.html` and `menu.html`

## Verification

1. Start server: `node serve.mjs`
2. Navigate to a product page as admin — verify checkbox, quantity, and drag handle appear on each variant row
3. Uncheck a variant — verify it dims in the admin panel
4. Save — reload — verify unchecked variant is hidden from customer pill view
5. Check menu.html — verify hidden variant is not in the Options dropdown
6. Drag a variant row — verify reorder persists after save + reload
7. Test on mobile viewport — verify touch drag works on the handle
