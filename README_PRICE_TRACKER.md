# Price Tracker برای Digikala MCP

این فورک یک لایه ردیابی قیمت واقعی به MCP اضافه می‌کند.

## ابزارهای جدید

### find_real_price_drops
محصولاتی را پیدا می‌کند که قیمت فعلی آنها نسبت به قیمت‌هایی که Worker قبلاً ذخیره کرده، افت قابل‌توجه داشته است.

مثال:
- قیمت قبلی: 10,000,000 تومان
- قیمت فعلی: 7,500,000 تومان
- افت واقعی: 25 درصد

این با درصد تخفیفی که خود دیجی‌کالا نمایش می‌دهد فرق دارد.

### price_history
snapshotهای جمع‌آوری‌شده برای یک محصول را نمایش می‌دهد.

## جمع‌آوری خودکار

Cloudflare Cron هر ساعت اجرا می‌شود و ابزار incredible_offers را از سرویس MCP اصلی می‌خواند و قیمت کالاهای تخفیف‌دار را در D1 ذخیره می‌کند.

برای تشخیص افت قیمت واقعی باید چند snapshot از یک کالا جمع شود.

## نصب روی Cloudflare

1. یک D1 Database با نام digikala-price-history بساز.
2. در wrangler.toml مقدار REPLACE_WITH_YOUR_D1_DATABASE_ID را با Database ID خودت عوض کن.
3. Migration را اجرا کن:

    npx wrangler d1 migrations apply digikala-price-history --remote

4. Deploy کن:

    npx wrangler deploy

بعد MCP URL تو به شکل زیر خواهد بود:

    https://YOUR-WORKER.workers.dev/mcp

## استفاده در MCP Client

    {
      "mcpServers": {
        "digikala": {
          "url": "https://YOUR-WORKER.workers.dev/mcp"
        }
      }
    }

## پیدا کردن تخفیف‌های زیاد

برای تخفیف فعلی خود دیجی‌کالا همچنان ابزار incredible_offers مناسب است و می‌توانی min_discount را مثلاً 50 بگذاری.

برای افت واقعی قیمت نسبت به تاریخچه‌ای که خودمان جمع کرده‌ایم، از find_real_price_drops با min_drop_percent برابر 20 و hours برابر 168 استفاده می‌شود.

## معماری فعلی

AI
↓
Worker تو
├── ابزارهای اصلی → MCP عمومی دیجی‌کالا
└── Price Tracker → D1 خودت
                         ↑
                  Cron هر ساعت

در مرحله بعد می‌توانیم upstream را حذف کنیم و Worker را مستقیماً به API دیجی‌کالا وصل کنیم تا سرویس کاملاً مستقل شود.
