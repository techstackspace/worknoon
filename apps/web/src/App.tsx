import { useEffect, useState, type FormEvent } from 'react';
import { api, asAmount, formatDate, formatMoney, type Customer, type Order, type Refund } from './api';

type View = 'customer' | 'support';

export function App() {
  const [view, setView] = useState<View>('customer');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerError, setCustomerError] = useState('');

  useEffect(() => { api.customers().then(setCustomers).catch((error: Error) => setCustomerError(error.message)); }, []);

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#home" aria-label="Worknoon home"><span className="brand-mark">w</span><span>worknoon<span className="brand-dot">.</span></span></a>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={view === 'customer' ? 'nav-button active' : 'nav-button'} onClick={() => setView('customer')}>Request a refund</button>
        <button className={view === 'support' ? 'nav-button active' : 'nav-button'} onClick={() => setView('support')}>Support dashboard</button>
      </nav>
      <span className="environment-chip"><span className="live-dot" /> Support portal</span>
    </header>
    <main>{view === 'customer' ? <CustomerFlow customers={customers} customerError={customerError} /> : <SupportDashboard />}</main>
    <footer className="page-footer">Worknoon support · Decisions follow the published refund policy</footer>
  </div>;
}

function CustomerFlow({ customers, customerError }: { customers: Customer[]; customerError: string }) {
  const [customerId, setCustomerId] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [lookupComplete, setLookupComplete] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Refund | null>(null);
  const selectedOrder = orders.find((order) => order.id === orderId);

  async function loadOrders(event?: FormEvent) {
    event?.preventDefault();
    const id = customerId.trim();
    if (!id) { setLookupError('Choose a customer or enter a customer ID first.'); return; }
    setLoadingOrders(true); setLookupError(''); setOrders([]); setOrderId(''); setResult(null); setLookupComplete(false);
    try { setOrders(await api.orders(id)); setLookupComplete(true); }
    catch (failure) { setLookupError((failure as Error).message); }
    finally { setLoadingOrders(false); }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setResult(null);
    const form = new FormData(event.currentTarget);
    const requestedAmount = Number(form.get('requestedAmount'));
    const customerMessage = String(form.get('customerMessage') ?? '').trim();
    if (!selectedOrder) { setError('Select an order before submitting your request.'); return; }
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > asAmount(selectedOrder.totalAmount)) {
      setError('Enter an amount greater than $0 and no more than the order total.'); return;
    }
    if (customerMessage.length < 3) { setError('Please add a little more detail about your request.'); return; }
    setLoading(true);
    try {
      setResult(await api.submitRefund({ customerId: customerId.trim(), orderId, requestedAmount, customerMessage }));
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }

  return <section className="page-content customer-page">
    <div className="hero-copy"><p className="eyebrow">CUSTOMER CARE</p><h1>Let’s make this right.</h1><p>Find your order and tell us what happened. Our support team will review your request.</p></div>
    {customerError && <Notice kind="error" message={customerError} />}
    <div className="customer-layout">
      <form className="panel request-panel" onSubmit={submitRequest}>
        <div className="panel-heading"><span className="step-number">01</span><div><h2>Your order</h2><p>Choose the customer and order you need help with.</p></div></div>
        <div className="field-row customer-lookup-row">
          <label className="field grow"><span>Customer ID</span>
            <input list="customer-options" value={customerId} onChange={(event) => { setCustomerId(event.target.value); setOrders([]); setOrderId(''); setLookupError(''); setLookupComplete(false); setResult(null); }} placeholder="Select or enter a customer ID" autoComplete="off" />
            <datalist id="customer-options">{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.firstName} {customer.lastName}</option>)}</datalist>
          </label>
          <button type="button" className="button secondary lookup-button" onClick={() => void loadOrders()} disabled={loadingOrders || !customerId.trim()}>
            {loadingOrders ? <><span className="spinner small" /> Loading</> : 'Find orders'}
          </button>
        </div>
        {lookupError && <p className="field-error">{lookupError}</p>}
        {orders.length > 0 && <label className="field order-select-field"><span>Order</span>
          <select value={orderId} onChange={(event) => { setOrderId(event.target.value); setResult(null); }} required>
            <option value="">Select an order</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.orderNumber} · {formatMoney(order.totalAmount, order.currency)}</option>)}
          </select>
        </label>}
        {orders.length === 0 && customerId.trim() && !loadingOrders && !lookupError && <p className="helper-text">{lookupComplete ? 'No orders were found for this customer.' : 'Find this customer’s orders to continue.'}</p>}
        {selectedOrder && <OrderSummary order={selectedOrder} />}
        <div className="section-divider" />
        <div className="panel-heading compact-heading"><span className="step-number">02</span><div><h2>Tell us what happened</h2><p>Share the amount and a short explanation.</p></div></div>
        <label className="field"><span>Requested amount <small>(up to {selectedOrder ? formatMoney(selectedOrder.totalAmount, selectedOrder.currency) : 'order total'})</small></span>
          <div className="amount-input-wrap"><span>$</span><input name="requestedAmount" type="number" min="0.01" max={selectedOrder ? asAmount(selectedOrder.totalAmount) : undefined} step="0.01" placeholder="0.00" required disabled={!selectedOrder} /></div>
        </label>
        <label className="field"><span>What can we help with?</span>
          <textarea name="customerMessage" rows={5} maxLength={5000} placeholder="Describe the issue with your order…" required disabled={!selectedOrder} />
          <small className="field-note">Your message is reviewed as customer-provided information.</small>
        </label>
        {error && <Notice kind="error" message={error} />}
        <button className="button primary submit-button" type="submit" disabled={loading || !selectedOrder}>
          {loading ? <><span className="spinner" /> Sending your request…</> : <>Submit refund request <span aria-hidden="true">→</span></>}
        </button>
        <p className="privacy-note">Your request is checked against the refund policy. The decision is made by our support system.</p>
      </form>
      <aside className="side-note"><div className="side-note-icon">?</div><h3>What happens next?</h3>
        <p>We’ll check your order details and the reason for your request. Some requests need a support specialist to take a closer look.</p>
        <div className="policy-points"><div><span>01</span><p>Most orders can be reviewed within 30 days.</p></div><div><span>02</span><p>Final-sale items may not qualify for a refund.</p></div><div><span>03</span><p>Higher-value requests receive extra review.</p></div></div>
      </aside>
    </div>
    {result && <CustomerResult refund={result} />}
  </section>;
}

function OrderSummary({ order }: { order: Order }) {
  return <section className="order-summary" aria-label="Selected order details">
    <div className="order-summary-top"><div><span className="mini-label">ORDER</span><strong>{order.orderNumber}</strong><code>{order.id}</code></div>
      <div className="order-total"><span className="mini-label">TOTAL</span><strong>{formatMoney(order.totalAmount, order.currency)}</strong></div></div>
    <p className="order-date">Placed {formatDate(order.purchasedAt)}</p>
    <div className="items-list">{order.items.map((item) => <div className="item-row" key={item.id}>
      <span className="item-bullet">{item.quantity}×</span><span className="item-name">{item.name}<small>SKU {item.sku}</small></span>
      <span className="item-price">{formatMoney(Number(item.unitPrice) * item.quantity, order.currency)}</span>
      {item.isFinalSale && <span className="final-sale-tag">Final sale</span>}
    </div>)}</div>
  </section>;
}

function CustomerResult({ refund }: { refund: Refund }) {
  const decision = refund.decision?.outcome ?? refund.status;
  return <section className="result-panel panel" aria-live="polite">
    <div className="result-heading"><span className={`decision-icon ${decision.toLowerCase()}`}>{decision === 'APPROVED' ? '✓' : decision === 'DENIED' ? '×' : '…'}</span>
      <div><p className="eyebrow">REQUEST RECEIVED</p><h2>Your request is {decisionLabel(decision)}.</h2></div></div>
    <p className="result-response">{refund.decision?.customerResponse ?? 'Your request has been received.'}</p>
    <p className="result-reference">Request reference <code>{refund.id}</code></p>
  </section>;
}

function SupportDashboard() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [selected, setSelected] = useState<Refund | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  async function refresh() {
    setLoading(true); setError('');
    try { const recent = await api.recentRefunds(); setRefunds(recent); if (recent.length === 0) setSelected(null); }
    catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function openDetail(refund: Refund) {
    setSelected(refund); setDetailLoading(true); setDetailError('');
    try { setSelected(await api.refund(refund.id)); }
    catch (failure) { setDetailError((failure as Error).message); }
    finally { setDetailLoading(false); }
  }

  return <section className="page-content dashboard-page">
    <div className="dashboard-title-row"><div className="hero-copy"><p className="eyebrow">WORKNOON · SUPPORT</p><h1>Refund requests</h1><p>Review policy decisions, AI analysis, and request history.</p></div>
      <button className="button secondary refresh-button" onClick={() => void refresh()} disabled={loading}><span aria-hidden="true">↻</span> Refresh</button></div>
    <div className="dashboard-summary"><div><span>Recent requests</span><strong>{refunds.length}</strong></div>
      <div><span>Escalated</span><strong>{refunds.filter((refund) => refund.status === 'ESCALATED').length}</strong></div>
      <div className="authority-callout"><span className="shield">✓</span><p><strong>Policy is authoritative</strong><small>AI analysis assists support and never changes the policy decision.</small></p></div></div>
    {error && <Notice kind="error" message={error} />}
    <div className="dashboard-layout">
      <section className="panel request-list-panel"><div className="list-heading"><div><h2>Latest requests</h2><p>Showing the latest {refunds.length} requests</p></div><span className="count-pill">{refunds.length}</span></div>
        {loading ? <LoadingState label="Loading refund requests…" /> : refunds.length === 0 ? <EmptyState title="No refund requests yet" body="Submitted requests will appear here for support review." />
          : <div className="request-list">{refunds.map((refund) => <button key={refund.id} className={`request-card ${selected?.id === refund.id ? 'selected' : ''}`} onClick={() => void openDetail(refund)}>
            <div className="request-card-top"><span className="request-customer">{refund.customer.firstName} {refund.customer.lastName}</span><StatusBadge status={refund.status} /></div>
            <div className="request-card-meta"><span>{refund.order.orderNumber}</span><span>{formatMoney(refund.requestedAmount, refund.order.currency)}</span></div>
            <p className="request-message-preview">{refund.message}</p>
            <div className="request-card-bottom"><code>{refund.id}</code><span>{formatDate(refund.createdAt)}</span></div>
          </button>)}</div>}
      </section>
      <section className="panel detail-panel">
        {detailLoading && <LoadingState label="Loading request details…" />}{detailError && <Notice kind="error" message={detailError} />}
        {!detailLoading && !detailError && !selected && <EmptyState title="Select a request" body="Choose a request from the list to inspect its decision and audit trail." />}
        {!detailLoading && selected && <RefundDetail refund={selected} />}
      </section>
    </div>
  </section>;
}

function RefundDetail({ refund }: { refund: Refund }) {
  const decision = refund.decision;
  const policy = decision?.policyEvaluation;
  const ai = policy?.ai;
  return <div className="detail-content">
    <div className="detail-title"><div><p className="eyebrow">REQUEST DETAIL</p><h2>{refund.order.orderNumber}</h2><code>{refund.id}</code></div><StatusBadge status={refund.status} /></div>
    <div className="detail-facts"><div><span>Customer</span><strong>{refund.customer.firstName} {refund.customer.lastName}</strong><small>{refund.customer.id}</small></div>
      <div><span>Order total</span><strong>{formatMoney(refund.order.totalAmount, refund.order.currency)}</strong><small>{formatDate(refund.order.purchasedAt)}</small></div>
      <div><span>Requested</span><strong>{formatMoney(refund.requestedAmount, refund.order.currency)}</strong><small>Submitted {formatDate(refund.createdAt)}</small></div></div>
    <div className="detail-section"><h3>Customer message</h3><p className="message-box">{refund.message}</p></div>
    <section className="decision-card">
      <div className="decision-card-heading"><span className="shield">✓</span><div><p className="eyebrow">AUTHORITATIVE RESULT</p><h3>Policy decision</h3></div><StatusBadge status={decision?.outcome ?? refund.status} /></div>
      <p className="decision-summary">{decision?.reasonSummary ?? 'No decision details available.'}</p><h4>Applicable policy rules</h4>
      {policy?.applicableRules?.length ? <ul className="rule-list">{policy.applicableRules.map((rule) => <li key={rule}>{humanize(rule)}</li>)}</ul> : <p className="muted-text">No policy rules recorded.</p>}
      {policy?.reasons?.length ? <ul className="reason-list">{policy.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul> : null}
      <div className="authoritative-note">The deterministic policy engine sets the decision. AI recommendations cannot override it.</div>
    </section>
    <section className="ai-card">
      <div className="ai-card-heading"><span className="ai-mark">AI</span><div><p className="eyebrow">ASSISTIVE ANALYSIS</p><h3>AI recommendation &amp; analysis</h3></div></div>
      {ai ? <>
        {!ai.available && <p className="ai-unavailable">AI service unavailable; fallback analysis was recorded.</p>}
        <div className="ai-recommendation-row"><span>Recommendation</span><StatusBadge status={ai.recommendation} /><small>Non-authoritative</small></div>
        <div className="ai-stats"><div><span>Classification</span><strong>{humanize(decision?.classification ?? 'UNKNOWN')}</strong></div><div><span>Confidence</span><strong>{Math.round(ai.confidence * 100)}%</strong></div></div>
        <div className="detail-section"><h4>Reasoning summary</h4><p>{ai.reasoningSummary || decision?.reasonSummary}</p></div>
        {(ai.uncertainty || ai.suspiciousOrConflicting) && <p className="signal-note">{ai.signalSummary || 'The AI identified uncertainty or a suspicious/conflicting signal.'}</p>}
        <p className="model-note">{ai.model} · {ai.promptVersion}</p>
      </> : <EmptyState title="No AI analysis" body="This request has no AI metadata recorded." />}
      {decision?.customerResponse && <div className="customer-response"><h4>Customer-facing response</h4><p>{decision.customerResponse}</p></div>}
    </section>
    <section className="detail-section audit-section"><h3>Audit trail</h3>
      {refund.auditLogs.length ? <ol className="audit-list">{refund.auditLogs.map((entry) => <li key={entry.id}><span className="audit-dot" /><div><strong>{humanize(entry.eventType)}</strong><p>{entry.summary}</p><time>{formatDate(entry.createdAt)}</time></div></li>)}</ol> : <p className="muted-text">No audit events recorded.</p>}
    </section>
  </div>;
}

function StatusBadge({ status }: { status: string }) { return <span className={`status-badge ${status.toLowerCase()}`}>{humanize(status)}</span>; }
function Notice({ kind, message }: { kind: 'error'; message: string }) { return <div className={`notice ${kind}`} role="alert"><span aria-hidden="true">!</span><p>{message}</p></div>; }
function LoadingState({ label }: { label: string }) { return <div className="state-box"><span className="spinner" /><p>{label}</p></div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="state-box empty-state"><span className="empty-icon">⌕</span><strong>{title}</strong><p>{body}</p></div>; }
function humanize(value: string): string { return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
function decisionLabel(decision: string): string { return decision.toLowerCase(); }
