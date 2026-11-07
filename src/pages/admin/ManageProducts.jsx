import { useState } from "react";
import { Alert, Badge, Field, Modal, StaffLayout } from "../../components/staff/StaffLayout";
import { useAuth } from "../../context/AuthContext";
import { api, formatMoney } from "../../lib/api";
import { imageUrl } from "../../lib/images";
import { useAction, useApi } from "../../lib/useApi";

const blank = {
  kind: "product", name: "", nameFr: "", description: "", categoryName: "", collection: "", badge: "",
  options: "", featured: false, durationMinutes: "", requiresBooking: false,
  sku: "", barcode: "", price: "", costPrice: "", initialStock: "", lowStockThreshold: 5,
};

function ProductForm({ initial, onDone }) {
  const editing = Boolean(initial?.id);
  const variant = initial?.variants?.[0];
  const [f, setF] = useState(() =>
    editing
      ? {
          ...blank,
          kind: initial.kind, name: initial.name, nameFr: initial.nameFr ?? "", description: initial.description ?? "",
          categoryName: initial.category?.name ?? "", collection: initial.collection ?? "", badge: initial.badge ?? "",
          options: (initial.options ?? []).join(", "), featured: initial.featured, durationMinutes: initial.durationMinutes ?? "",
          requiresBooking: initial.requiresBooking, sku: variant?.sku ?? "", barcode: variant?.barcode ?? "",
          price: variant?.price ?? "", costPrice: variant?.costPrice ?? "", lowStockThreshold: variant?.lowStockThreshold ?? 5,
        }
      : blank
  );
  const [files, setFiles] = useState([]);
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const product = {
        kind: f.kind, name: f.name, nameFr: f.nameFr || null, description: f.description,
        categoryName: f.categoryName || undefined, collection: f.collection || null, badge: f.badge || null,
        options: f.options.split(",").map((s) => s.trim()).filter(Boolean), featured: f.featured,
        durationMinutes: f.kind === "service" && f.durationMinutes ? Number(f.durationMinutes) : null,
        requiresBooking: f.kind === "service" && f.requiresBooking,
      };
      const variantData = {
        ...(f.sku && { sku: f.sku }), barcode: f.barcode || null, price: Number(f.price), costPrice: Number(f.costPrice || 0),
        lowStockThreshold: Number(f.lowStockThreshold || 0),
      };
      let id = initial?.id;
      if (editing) {
        await api.patch(`/api/admin/products/${id}`, product);
        if (variant) await api.patch(`/api/admin/variants/${variant.id}`, variantData);
      } else {
        const res = await api.post("/api/admin/products", {
          ...product,
          variants: [{ ...variantData, trackStock: f.kind === "product", initialStock: Number(f.initialStock || 0) }],
        });
        id = res.data.id;
      }
      if (files.length) {
        const form = new FormData();
        for (const file of files) form.append("images", file);
        await api.upload(`/api/admin/products/${id}/images`, form);
      }
      onDone();
    });
  };

  const removeImage = (url) =>
    run(async () => {
      await api.del(`/api/admin/products/${initial.id}/images`, { url });
      onDone();
    });

  return (
    <form className="st-form" onSubmit={submit}>
      <Alert kind="error">{error}</Alert>
      <div className="st-row">
        <Field label="Type">
          <select value={f.kind} onChange={set("kind")} disabled={editing}>
            <option value="product">Product (has stock)</option>
            <option value="service">Service (no stock)</option>
          </select>
        </Field>
        <Field label="Name (English)"><input required minLength={2} value={f.name} onChange={set("name")} /></Field>
        <Field label="Name (French)"><input value={f.nameFr} onChange={set("nameFr")} /></Field>
      </div>
      <div className="st-row">
        <Field label="Category"><input value={f.categoryName} onChange={set("categoryName")} placeholder="e.g. Halal Drinks" /></Field>
        <Field label="Collection"><input value={f.collection} onChange={set("collection")} /></Field>
        <Field label="Badge"><input value={f.badge} onChange={set("badge")} maxLength={40} /></Field>
      </div>
      <Field label="Description"><textarea value={f.description} onChange={set("description")} /></Field>
      <Field label="Options shown to customers (comma separated, e.g. S, M, L)"><input value={f.options} onChange={set("options")} /></Field>
      <div className="st-row">
        <Field label="Selling price (FCFA)"><input type="number" min={0} required value={f.price} onChange={set("price")} /></Field>
        <Field label="Cost price (FCFA)"><input type="number" min={0} value={f.costPrice} onChange={set("costPrice")} /></Field>
        <Field label="SKU (auto if empty)"><input value={f.sku} onChange={set("sku")} pattern="[A-Za-z0-9._-]+" /></Field>
        <Field label="Barcode"><input value={f.barcode} onChange={set("barcode")} /></Field>
      </div>
      {f.kind === "product" ? (
        <div className="st-row">
          {!editing && <Field label="Opening stock"><input type="number" min={0} value={f.initialStock} onChange={set("initialStock")} /></Field>}
          <Field label="Low-stock alert at"><input type="number" min={0} value={f.lowStockThreshold} onChange={set("lowStockThreshold")} /></Field>
        </div>
      ) : (
        <div className="st-row">
          <Field label="Duration (minutes)"><input type="number" min={1} value={f.durationMinutes} onChange={set("durationMinutes")} /></Field>
          <label className="st-check"><input type="checkbox" checked={f.requiresBooking} onChange={set("requiresBooking")} /> Requires a booking date</label>
        </div>
      )}
      {editing && <p className="st-muted">To change stock quantities use the Stock page, so every change is recorded with a reason.</p>}
      <label className="st-check"><input type="checkbox" checked={f.featured} onChange={set("featured")} /> Featured on the shop</label>
      <Field label="Add images (JPEG, PNG or WebP, max 5 MB each)">
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles([...e.target.files].slice(0, 6))} />
      </Field>
      {editing && initial.images?.length > 0 && (
        <div className="st-actions">
          {initial.images.map((url) => (
            <div key={url} style={{ textAlign: "center" }}>
              <img src={imageUrl(url)} alt="" width={72} height={72} style={{ objectFit: "cover", borderRadius: 10 }} loading="lazy" />
              <br />
              <button type="button" className="st-btn danger small" onClick={() => removeImage(url)}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <div><button className="st-btn" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Create"}</button></div>
    </form>
  );
}

function ManageProducts() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const { data, error, reload } = useApi(`/api/admin/products?limit=500&status=${status}${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  const [modal, setModal] = useState(null);
  const action = useAction();
  const products = data?.data ?? [];
  const showCost = can("products.view_cost");

  const toggleActive = (p) =>
    action.run(async () => {
      await api.patch(`/api/admin/products/${p.id}`, { isActive: !p.isActive });
      await reload();
    });

  return (
    <StaffLayout title="Products & services" subtitle="Prices, cost prices and catalogue details. Every price change is recorded in the audit log." actions={<button className="st-btn gold" onClick={() => setModal({})}>+ New product / service</button>}>
      <Alert kind="error">{error || action.error}</Alert>
      <section className="st-card">
        <div className="st-toolbar">
          <input className="st-input" placeholder="Search name, collection, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="st-input" style={{ flex: "0 0 auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option><option value="active">Active</option><option value="inactive">Hidden</option><option value="low">Low stock</option><option value="out">Out of stock</option>
          </select>
          <span className="st-muted">{data?.total ?? 0} items</span>
        </div>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th></th><th>Name</th><th>SKU</th><th className="num">Price</th>{showCost && <th className="num">Cost</th>}{showCost && <th className="num">Margin</th>}<th className="num">Available</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {products.map((p) => {
                const v = p.variants[0] ?? {};
                const margin = showCost && v.price ? Math.round(((v.price - (v.costPrice ?? 0)) / v.price) * 100) : null;
                return (
                  <tr key={p.id}>
                    <td>{p.images[0] && <img src={imageUrl(p.images[0])} alt="" width={44} height={44} style={{ objectFit: "cover", borderRadius: 8 }} loading="lazy" />}</td>
                    <td><strong>{p.name}</strong><div className="st-muted">{p.category?.name}{p.collection ? ` / ${p.collection}` : ""}{p.kind === "service" ? " - service" : ""}</div></td>
                    <td>{v.sku}</td>
                    <td className="num">{formatMoney(v.price)}</td>
                    {showCost && <td className="num">{v.costPrice ? formatMoney(v.costPrice) : <Badge status="pending">not set</Badge>}</td>}
                    {showCost && <td className="num">{margin}%</td>}
                    <td className="num">{v.trackStock ? <Badge status={v.available <= 0 ? "refunded" : v.lowStock ? "pending" : "active"}>{v.available}</Badge> : "-"}</td>
                    <td><Badge status={p.isActive ? "active" : "closed"}>{p.isActive ? "visible" : "hidden"}</Badge></td>
                    <td><div className="st-actions"><button className="st-btn light small" onClick={() => setModal(p)}>Edit</button><button className="st-btn light small" onClick={() => toggleActive(p)}>{p.isActive ? "Hide" : "Show"}</button></div></td>
                  </tr>
                );
              })}
              {!products.length && <tr><td colSpan={9} className="st-empty">No products.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {modal && (
        <Modal title={modal.id ? `Edit ${modal.name}` : "New product or service"} onClose={() => setModal(null)}>
          <ProductForm
            initial={modal}
            onDone={async () => {
              await reload();
              setModal(null);
            }}
          />
        </Modal>
      )}
    </StaffLayout>
  );
}

export default ManageProducts;
