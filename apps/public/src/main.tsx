import {
  StrictMode,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Product = {
  id: string;
  model: string;
  brand: string;
  origin: string;
  productLine: string;
  publicName: string;
  publicDescription: string;
  publicMin: number;
  publicMax: number;
  currency: string;
  unit: string;
  referenceTpm: number | null;
  serviceNote: string;
  hasPdf: boolean;
  pdfDownload?: boolean | number;
};

type CompareGroup = {
  currency: string;
  unit: string;
  data: Product[];
};

type PublicDictionary = {
  id: string;
  type: "model" | "brand" | "origin" | "product_line";
  name: string;
};

const API_BASE =
  import.meta.env.VITE_PUBLIC_API_BASE ?? "http://localhost:8787";

const fallbackProducts: Product[] = [
  {
    id: "preview-1",
    model: "Claude",
    brand: "Anthropic",
    origin: "海外",
    productLine: "直客",
    publicName: "稳健推理方案",
    publicDescription: "适合长文本分析、代码审查和日常生产力场景。",
    publicMin: 0.72,
    publicMax: 0.8,
    currency: "CNY",
    unit: "折扣率",
    referenceTpm: 5000,
    serviceNote: "稳定服务，支持技术咨询",
    hasPdf: false,
  },
  {
    id: "preview-2",
    model: "Gemini",
    brand: "Google",
    origin: "海外",
    productLine: "中转",
    publicName: "多模态快速通道",
    publicDescription: "面向图片理解和高并发调用的轻量接入方案。",
    publicMin: 0.26,
    publicMax: 0.31,
    currency: "CNY",
    unit: "折扣率",
    referenceTpm: 10000,
    serviceNote: "支持高峰期扩容",
    hasPdf: false,
  },
];

function formatPrice(product: Product) {
  const value =
    product.publicMin === product.publicMax
      ? product.publicMin.toString()
      : `${product.publicMin} – ${product.publicMax}`;
  return product.unit === "折扣率"
    ? `${value} 折`
    : `${product.currency} ${value} / ${product.unit}`;
}

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [view, setView] = useState<"catalog" | "compare" | "quote">("catalog");
  const [selected, setSelected] = useState<string[]>([]);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [line, setLine] = useState("全部产品线");
  const [origin, setOrigin] = useState("全部来源");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ pageSize: 20, total: 0 });
  const [apiFailed, setApiFailed] = useState(false);
  const [publicDictionaries, setPublicDictionaries] = useState<
    PublicDictionary[]
  >([]);
  const [selectedProducts, setSelectedProducts] = useState<
    Record<string, Product>
  >({});
  const [compareModel, setCompareModel] = useState("");
  const [compareGroups, setCompareGroups] = useState<CompareGroup[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    fetch(`${API_BASE}/api/public/dictionaries`)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("dictionary API unavailable")),
      )
      .then((payload: { data: PublicDictionary[] }) =>
        setPublicDictionaries(payload.data),
      )
      .catch(() => setPublicDictionaries([]));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(meta.pageSize),
    });
    if (debouncedKeyword) params.set("q", debouncedKeyword);
    if (line !== "全部产品线") params.set("productLine", line);
    if (origin !== "全部来源") params.set("origin", origin);
    setLoading(true);
    fetch(`${API_BASE}/api/public/products?${params.toString()}`)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("API unavailable")),
      )
      .then((payload: { data: Product[]; meta?: { pageSize: number; total: number } }) => {
        setProducts(payload.data);
        setSelectedProducts((current) => {
          const next = { ...current };
          payload.data.forEach((item) => {
            if (next[item.id]) next[item.id] = item;
          });
          return next;
        });
        setApiFailed(false);
        if (payload.meta) setMeta(payload.meta);
      })
      .catch(() => {
        setApiFailed(true);
        setProducts(fallbackProducts);
      })
      .finally(() => setLoading(false));
  }, [page, meta.pageSize, debouncedKeyword, line, origin]);

  const source = apiFailed && import.meta.env.DEV ? fallbackProducts : products;
  const dictionaryValues = (type: PublicDictionary["type"], fallback: string[]) => {
    const values = publicDictionaries
      .filter((item) => item.type === type)
      .map((item) => item.name);
    return values.length ? values : fallback;
  };
  const lines = useMemo(
    () => [
      "全部产品线",
      ...dictionaryValues(
        "product_line",
        [...new Set(source.map((item) => item.productLine))],
      ),
    ],
    [publicDictionaries, source],
  );
  const models = useMemo(
    () =>
      dictionaryValues(
        "model",
        [...new Set(source.map((item) => item.model))],
      ).sort(),
    [publicDictionaries, source],
  );
  useEffect(() => {
    if (!compareModel && models.length) setCompareModel(models[0]);
    if (compareModel && !models.includes(compareModel)) setCompareModel("");
  }, [compareModel, models]);
  useEffect(() => {
    if (view !== "compare" || !compareModel) {
      setCompareGroups([]);
      return;
    }
    const query = new URLSearchParams({ model: compareModel });
    if (line !== "全部产品线") query.set("productLine", line);
    setCompareLoading(true);
    fetch(`${API_BASE}/api/public/compare?${query.toString()}`)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("compare unavailable")),
      )
      .then((payload: { data?: Product[]; groups?: CompareGroup[] }) => {
        if (payload.groups) {
          setCompareGroups(payload.groups);
          return;
        }
        const grouped = new Map<string, Product[]>();
        for (const item of payload.data ?? []) {
          const key = `${item.currency} / ${item.unit}`;
          grouped.set(key, [...(grouped.get(key) ?? []), item]);
        }
        setCompareGroups(
          [...grouped.entries()].map(([key, data]) => {
            const [currency, unit] = key.split(" / ");
            return { currency, unit, data };
          }),
        );
      })
      .catch(() => setCompareGroups([]))
      .finally(() => setCompareLoading(false));
  }, [API_BASE, compareModel, line, view]);
  const origins = useMemo(
    () => [
      "全部来源",
      ...dictionaryValues(
        "origin",
        [...new Set(source.map((item) => item.origin))],
      ),
    ],
    [publicDictionaries, source],
  );
  const filtered = source;
  const quoteProducts = selected
    .map((id) => selectedProducts[id])
    .filter((product): product is Product => Boolean(product));
  const toggleSelected = (product: Product) => {
    setSelected((items) =>
      items.includes(product.id)
        ? items.filter((id) => id !== product.id)
        : [...items, product.id],
    );
    setSelectedProducts((items) => {
      if (items[product.id]) {
        const next = { ...items };
        delete next[product.id];
        return next;
      }
      return { ...items, [product.id]: product };
    });
  };
  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">MODEL PRICE / PUBLIC CATALOG</div>
        <div className="hero-row">
          <div>
            <h1>
              把合适的模型，<em>报价清楚。</em>
            </h1>
            <p>面向业务团队的公开方案目录。只呈现可对外使用的信息。</p>
          </div>
          <a
            className="admin-link"
            href={import.meta.env.VITE_ADMIN_URL ?? "https://admin.example.com"}
          >
            运营入口 <span>↗</span>
          </a>
        </div>
        <div className="search-panel">
          <label className="search-input">
            <span>⌕</span>
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
              placeholder="搜索模型、品牌或公开方案"
            />
          </label>
          <select
            value={line}
            onChange={(event) => {
              setLine(event.target.value);
              setPage(1);
            }}
            aria-label="产品线"
          >
            {lines.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select
            value={origin}
            onChange={(event) => {
              setOrigin(event.target.value);
              setPage(1);
            }}
            aria-label="来源"
          >
            {origins.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
      </header>

      <nav className="public-nav" aria-label="公开功能">
        <button
          className={view === "catalog" ? "active" : ""}
          onClick={() => setView("catalog")}
        >
          搜索方案
        </button>
        <button
          className={view === "compare" ? "active" : ""}
          onClick={() => setView("compare")}
        >
          匿名比价
        </button>
        <button
          className={view === "quote" ? "active" : ""}
          onClick={() => setView("quote")}
        >
          参考报价单 <span>{selected.length}</span>
        </button>
      </nav>

      {view === "compare" && (
        <div className="compare-controls">
          <label>
            <span>选择模型</span>
            <select
              value={compareModel}
              onChange={(event) => setCompareModel(event.target.value)}
              aria-label="选择模型"
            >
              <option value="">请选择模型</option>
              {models.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <small>仅比较同一模型，且按币种与计价单位分组</small>
        </div>
      )}

      <section className="catalog-head">
        <div>
          <span className="section-kicker">LIVE CATALOG</span>
          <h2>
            {view === "catalog"
              ? "公开方案"
              : view === "compare"
                ? "匿名比价"
                : "选择报价方案"}
          </h2>
        </div>
        <div className="catalog-meta">
          {loading
            ? "正在同步"
            : `${filtered.length} / ${meta.total || filtered.length} 个方案`}{" "}
          <span className="status-dot" />
        </div>
      </section>

      {view !== "compare" && (
        <>
        <section className="cards" aria-live="polite">
          {filtered.map((product, index) => (
            <article
              className="product-card"
              key={product.id}
              style={{ "--delay": `${index * 60}ms` } as CSSProperties}
            >
              <div className="card-top">
                <span className="index">0{index + 1}</span>
                <span className="pill">{product.origin}</span>
                <span className="pill pill-quiet">{product.productLine}</span>
              </div>
              <div className="model-line">
                <h3>{product.model}</h3>
                <span>{product.brand}</span>
              </div>
              <p className="public-name">{product.publicName}</p>
              <p className="description">{product.publicDescription}</p>
              <div className="card-footer">
                <div>
                  <div className="price">{formatPrice(product)}</div>
                  <div className="price-caption">
                    公开参考价 · {product.unit}
                  </div>
                </div>
                <div className="facts">
                  <span>
                    {product.referenceTpm
                      ? `${product.referenceTpm.toLocaleString()} TPM`
                      : "按需"}
                  </span>
                  <span>{product.serviceNote || "标准服务"}</span>
                  {product.hasPdf && (
                    <a
                      className="pdf"
                      href={`${API_BASE}/api/public/products/${product.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      资料 PDF ↗
                    </a>
                  )}
                  {product.hasPdf && product.pdfDownload !== 0 && (
                    <a
                      className="pdf"
                      href={`${API_BASE}/api/public/products/${product.id}/pdf`}
                      download
                    >
                      下载 PDF ↓
                    </a>
                  )}
                </div>
              </div>
              {view === "quote" && (
                <button
                  className={`select-product ${selected.includes(product.id) ? "selected" : ""}`}
                  onClick={() => toggleSelected(product)}
                >
                  {selected.includes(product.id)
                    ? "已加入报价单 ✓"
                    : "加入参考报价单"}
                </button>
              )}
            </article>
          ))}
          {!filtered.length && (
            <div className="empty">没有匹配的公开方案，换个关键词试试。</div>
          )}
        </section>
        <div className="public-pagination">
          <select
            value={meta.pageSize}
            onChange={(event) => {
              setMeta((current) => ({ ...current, pageSize: Number(event.target.value) }));
              setPage(1);
            }}
            aria-label="每页数量"
          >
            <option value={20}>20 条/页</option>
            <option value={50}>50 条/页</option>
            <option value={100}>100 条/页</option>
          </select>
          <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>上一页</button>
          <span>第 {page} 页</span>
          <button disabled={page * meta.pageSize >= meta.total} onClick={() => setPage((value) => value + 1)}>下一页</button>
        </div>
        </>
      )}

      {view === "compare" && (
        <section className="compare-table">
          {!compareModel && <div className="empty">请选择模型后开始比较。</div>}
          {compareLoading && <div className="empty">正在加载比价结果…</div>}
          {!compareLoading &&
            compareModel &&
            compareGroups.map((group) => (
              <div className="compare-group" key={`${group.currency}/${group.unit}`}>
                <div className="compare-group-title">
                  {group.currency} / {group.unit}
                </div>
                <div className="compare-row compare-head">
                  <span>匿名方案</span>
                  <span>模型 / 来源</span>
                  <span>产品线</span>
                  <span>对外价格</span>
                </div>
                {group.data.map((product, index) => (
                  <div className="compare-row" key={product.id}>
                    <span>
                      <b>方案 {String.fromCharCode(65 + index)}</b>
                      <small>{product.publicName}</small>
                    </span>
                    <span>
                      {product.model}
                      <small>
                        {product.brand} · {product.origin}
                      </small>
                    </span>
                    <span>{product.productLine}</span>
                    <span className="compare-price">
                      {formatPrice(product)}
                      <small>
                        {product.currency} / {product.unit}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          {!compareLoading && compareModel && !compareGroups.length && (
            <div className="empty">当前模型暂无可比较的公开方案。</div>
          )}
        </section>
      )}

      {view === "quote" && (
        <div className="quote-bar">
          <div>
            <b>已选择 {selected.length} 个方案</b>
            <span>报价只使用当前对外价格，访客不可修改。</span>
          </div>
          <button
            disabled={!selected.length}
            onClick={() => setQuoteOpen(true)}
          >
            生成参考报价单
          </button>
        </div>
      )}

      {quoteOpen && (
        <div className="quote-modal" role="dialog" aria-modal="true">
          <div className="quote-sheet">
            <div className="quote-tools">
              <button onClick={() => window.print()}>打印 / 另存为 PDF</button>
              <button onClick={() => setQuoteOpen(false)}>关闭</button>
            </div>
            <div className="quote-brand">MODEL PRICE HUB</div>
            <h2>参考报价单</h2>
            <p className="quote-warning">
              系统参考报价，最终价格及服务条款以商务确认为准
            </p>
            <div className="quote-date">
              生成日期：{new Date().toLocaleDateString("zh-CN")}
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>模型 / 方案</th>
                  <th>规格</th>
                  <th>公开参考价</th>
                </tr>
              </thead>
              <tbody>
                {quoteProducts.map((product, index) => (
                  <tr key={product.id}>
                    <td>{index + 1}</td>
                    <td>
                      <b>{product.model}</b>
                      <br />
                      {product.publicName}
                    </td>
                    <td>
                      {product.productLine} · {product.origin}
                      <br />
                      {product.referenceTpm
                        ? `${product.referenceTpm.toLocaleString()} TPM`
                        : "按需"}
                    </td>
                    <td>{formatPrice(product)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="quote-terms">
              本报价单不代表正式商业承诺，不包含供方签章，价格和服务内容以商务最终确认为准。
            </p>
          </div>
        </div>
      )}

      <footer>
        <span>参考报价 · 最终价格及服务条款以商务确认为准</span>
        <span>NOINDEX / PUBLIC VIEW</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
