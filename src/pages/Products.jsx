import { useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import ProductCard from "../components/ProductCard";
import { useStore } from "../context/StoreContext";

function Products() {
  const { products, productsLoading, productsError, productCategories } = useStore();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("featured");
  const [inStockOnly, setInStockOnly] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (!inStockOnly || p.stock > 0) &&
        (!q || `${p.name} ${p.category} ${p.collection} ${p.description} ${p.sku}`.toLowerCase().includes(q))
    );
    const sorters = {
      featured: (a, b) => Number(b.featured) - Number(a.featured),
      price_asc: (a, b) => a.price - b.price,
      price_desc: (a, b) => b.price - a.price,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(sorters[sort]);
  }, [products, search, category, sort, inStockOnly]);

  return (
    <>
      <Navbar />

      <main className="products-page">
        <style>{`
          .products-toolbar {
            display: grid;
            grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr)) auto;
            gap: 12px;
            align-items: center;
            margin: 0 auto 24px;
          }
          .products-toolbar input[type="search"],
          .products-toolbar select {
            width: 100%;
            min-height: 46px;
            padding: 0 14px;
            border-radius: 14px;
            border: 1px solid rgba(0, 74, 173, 0.16);
            background: #fff;
            color: #001f4d;
            font-weight: 700;
          }
          .products-instock { display: flex; gap: 6px; align-items: center; color: #001f4d; font-weight: 800; white-space: nowrap; }
          .products-state { text-align: center; color: #667085; font-weight: 800; padding: 24px; }
          @media (max-width: 720px) { .products-toolbar { grid-template-columns: 1fr 1fr; } .products-toolbar input[type="search"] { grid-column: 1 / -1; } }
`}</style>
        <style>{`
          .products-page {
            min-height: 100vh;
            padding: 34px 18px 60px;
            background:
              radial-gradient(circle at 12% 8%, rgba(212, 175, 55, 0.18), transparent 28%),
              radial-gradient(circle at 88% 14%, rgba(11, 94, 215, 0.13), transparent 30%),
              linear-gradient(135deg, #f7f9ff 0%, #ffffff 48%, #f7f9ff 100%);
          }

          .products-container {
            width: min(1240px, 100%);
            margin: 0 auto;
          }

          .products-heading-wrap {
            position: relative;
            width: min(880px, 100%);
            margin: 0 auto 34px;
            padding: 4px;
            border-radius: 34px;
            background: linear-gradient(135deg, rgba(212,175,55,.9), rgba(255,255,255,.85), rgba(11,94,215,.7));
            box-shadow: 0 22px 60px rgba(0, 31, 77, 0.13);
          }

          .products-heading {
            position: relative;
            overflow: hidden;
            text-align: center;
            padding: 28px 24px 26px;
            border-radius: 30px;
            background:
              radial-gradient(circle at 15% 20%, rgba(212,175,55,.24), transparent 30%),
              radial-gradient(circle at 85% 15%, rgba(11,94,215,.18), transparent 34%),
              linear-gradient(135deg, #ffffff 0%, #f8fbff 52%, #ffffff 100%);
            border: 1px solid rgba(255,255,255,.8);
          }

          .products-heading::before,
          .products-heading::after {
            content: "";
            position: absolute;
            width: 150px;
            height: 150px;
            border-radius: 999px;
            border: 1px solid rgba(212,175,55,.22);
            pointer-events: none;
          }

          .products-heading::before {
            left: -70px;
            top: -70px;
            background: rgba(212,175,55,.08);
          }

          .products-heading::after {
            right: -70px;
            bottom: -70px;
            background: rgba(11,94,215,.06);
          }

          .heading-badge {
            position: relative;
            z-index: 2;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-bottom: 12px;
            padding: 8px 15px;
            border-radius: 999px;
            background: linear-gradient(135deg, #001f4d, #0b5ed7);
            color: #fff7d6;
            font-size: 11px;
            font-weight: 950;
            letter-spacing: 1.1px;
            text-transform: uppercase;
            box-shadow: 0 12px 30px rgba(0,31,77,.18);
          }

          .heading-badge span {
            color: #d4af37;
          }

          .products-title {
            position: relative;
            z-index: 2;
            margin: 0;
            color: #001f4d;
            font-size: clamp(30px, 4.5vw, 48px);
            line-height: 1;
            font-weight: 1000;
            letter-spacing: -1.2px;
            text-transform: uppercase;
          }

          .products-title strong {
            display: inline-block;
            padding: 0 10px 8px;
            background: linear-gradient(135deg, #001f4d, #0b5ed7, #001f4d);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            border-bottom: 4px solid #d4af37;
            border-radius: 0 0 18px 18px;
          }

          .products-subtitle {
            position: relative;
            z-index: 2;
            width: min(760px, 100%);
            margin: 16px auto 0;
            color: #4b5563;
            font-size: 14.5px;
            line-height: 1.75;
            font-weight: 750;
          }

          .products-subtitle b {
            color: #001f4d;
            font-weight: 1000;
          }

          .products-tags {
            position: relative;
            z-index: 2;
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 9px;
            margin-top: 18px;
          }

          .products-tags span {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(255,255,255,.9);
            border: 1px solid rgba(212,175,55,.28);
            color: #001f4d;
            font-size: 11.5px;
            font-weight: 950;
            box-shadow: 0 10px 24px rgba(0,31,77,.07);
          }

          .products-divider {
            position: relative;
            z-index: 2;
            width: min(380px, 80%);
            height: 1px;
            margin: 18px auto 0;
            background: linear-gradient(90deg, transparent, rgba(212,175,55,.9), rgba(11,94,215,.7), rgba(212,175,55,.9), transparent);
          }

          .products-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(265px, 1fr));
            gap: 24px;
            align-items: stretch;
          }

          @media (max-width: 720px) {
            .products-page {
              padding: 22px 12px 44px;
            }

            .products-heading-wrap {
              margin-bottom: 24px;
              border-radius: 26px;
            }

            .products-heading {
              padding: 24px 16px 22px;
              border-radius: 22px;
            }

            .products-title {
              font-size: 30px;
            }

            .products-subtitle {
              font-size: 13px;
            }

            .products-grid {
              grid-template-columns: 1fr;
              gap: 18px;
            }
          }
        `}</style>

        <div className="products-container">
          <section className="products-heading-wrap">
            <div className="products-heading">
              <div className="heading-badge">
                <span>✦</span> Premium CHAFADIA Collection <span>✦</span>
              </div>

              <h1 className="products-title">
                <strong>Our Products</strong>
              </h1>

              <p className="products-subtitle">
                Explore premium <b>CHAFADIA ENTERPRISE</b> products for beauty,
                modest fashion, wellness, cleanliness, hygiene, halal drinks,
                crispy chips, natural botanicals, and everyday family essentials.
              </p>

              <div className="products-tags">
                <span>✨ Beauty</span>
                <span>👗 Fashion</span>
                <span>🧼 Cleanliness</span>
                <span>🛡️ Hygiene</span>
                <span>🥤 Halal Drinks</span>
                <span>🍌 Crispy Chips</span>
                <span>🌿 Botanicals</span>
              </div>

              <div className="products-divider" />
            </div>
          </section>

          <div className="products-toolbar">
            <input
              type="search"
              placeholder="Search products, collections..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search products"
            />
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              {productCategories.map((c) => (
                <option key={c} value={c}>{c === "All" ? "All categories" : c}</option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="featured">Featured</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="name">Name</option>
            </select>
            <label className="products-instock">
              <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> In stock
            </label>
          </div>

          {productsLoading && <p className="products-state">Loading products...</p>}
          {productsError && <p className="products-state">Could not load products: {productsError}</p>}
          {!productsLoading && !productsError && visible.length === 0 && <p className="products-state">No products match your search.</p>}

          <div className="products-grid">
            {visible.map((product) => (
              <ProductCard product={product} key={product.id} />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}

export default Products;
