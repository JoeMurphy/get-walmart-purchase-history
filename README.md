# Get Walmart Purchase History

A Chrome extension that exports your Walmart in-store purchase history to CSV.

Walmart doesn't offer a way to export your order history, so this extension scrapes it for you. It paginates through your orders, visits each order detail page, and downloads a CSV with every item, price, quantity, and store location.

## Install

1. Download or clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select this folder
5. Pin the extension for easy access

## Usage

1. Go to [walmart.com/orders](https://www.walmart.com/orders) (you must be logged in)
2. Click the extension icon
3. Click **Start Scraping**
4. Wait for it to finish -- it automatically downloads a CSV when done

The extension paginates through all your orders, filters for in-store purchases, then visits each order detail page to extract item-level data. A status banner at the top of the page shows progress.

If the page reloads mid-scrape (e.g. navigating between order details), the extension auto-resumes from where it left off using session storage.

## CSV Output

The downloaded file is named `walmart_store_orders_YYYY-MM-DD.csv` with these columns:

| Column | Description |
|---|---|
| Order ID | Walmart order identifier |
| Order Date | Purchase date |
| Item Name | Product name |
| Quantity | Number of units |
| Weight | Weight (for weighted items, e.g. `1.59 lb`) |
| Price | Item price |
| Product ID | Walmart product identifier |
| Product URL | Link to product page |
| Subtotal | Order subtotal (first item row only) |
| Tax | Order tax (first item row only) |
| Total | Order total (first item row only) |
| Store Name | Store where purchased (first item row only) |
| Store Address | Store address (first item row only) |
| Order URL | Link to order detail page (first item row only) |
| Timestamp | When the data was scraped |

Order-level fields (Subtotal through Timestamp) only appear on the first item row for each order.

## Limitations

- Only exports **in-store** orders (delivery/pickup orders are skipped)
- Walmart's page structure may change, which could break the scraper
- Processes up to 50 pages of order history (~500 orders)
- Each order detail page takes a few seconds to load and parse

## Permissions

- **activeTab** and **storage** -- needed to interact with the Walmart orders page
- **Host permission** for `https://www.walmart.com/orders*` -- only runs on the orders page

## License

MIT
