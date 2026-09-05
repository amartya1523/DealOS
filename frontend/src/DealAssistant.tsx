import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Check, ChevronDown, LoaderCircle, Mic, MicOff, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { request, type Workspace } from './api';

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };
type AssistantAction = {
  type: 'CREATE_INVOICE'; label: string; summary: string;
  payload: { customerId: string; dueAt: string; lines: Array<{ productId: string; quantity: number; discount: number }>; sendReceipt: boolean };
  preview: { customer: string; dueAt: string; lines: Array<{ product: string; quantity: number; discount: number; total: number }>; total: number };
} | {
  type: 'ADD_QUOTE_COMMENT'; label: string; summary: string;
  payload: { quoteId: string; message: string };
  preview: { quoteNumber: string; customer: string; message: string };
};
type AssistantResponse = { message: string; action: AssistantAction | null };

type SpeechRecognitionEventLike = { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: SpeechRecognitionEventLike) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);

export function DealAssistant({ workspace, screen, onChanged }: { workspace?: Workspace | null; screen?: string; onChanged?: () => void | Promise<void> }) {
  const internal = Boolean(workspace);
  const canCreate = Boolean(workspace && !workspace.user.viewContext && ['ADMIN', 'FINANCE'].includes(workspace.user.role) && (workspace.user.role === 'ADMIN' || workspace.user.moduleAccess.includes('invoices')));
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [action, setAction] = useState<AssistantAction | null>(null);
  const [completed, setCompleted] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const greeting = internal
    ? `Hi ${workspace?.user.name.split(' ')[0]}. I can read this workspace${canCreate ? ' and prepare invoices for your confirmation' : ''}.`
    : 'Hi! I can help you understand DealOS and its quote-to-cash workflow.';

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, action, busy]);
  useEffect(() => () => recognition.current?.stop(), []);

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    const next = [...messages, { id: crypto.randomUUID(), role: 'user' as const, content: clean }];
    setMessages(next); setInput(''); setAction(null); setCompleted(false); setBusy(true);
    try {
      const response = await request<AssistantResponse>(internal ? '/assistant' : '/assistant/public', { method: 'POST', body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), ...(screen ? { screen } : {}) }) });
      setMessages(value => [...value, { id: crypto.randomUUID(), role: 'assistant', content: response.message }]);
      setAction(response.action);
    } catch (error) {
      setMessages(value => [...value, { id: crypto.randomUUID(), role: 'assistant', content: error instanceof Error ? error.message : 'The assistant is unavailable right now.' }]);
    } finally { setBusy(false); }
  }

  function toggleVoice() {
    if (listening) { recognition.current?.stop(); return; }
    const ctor = (window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition
      ?? (window as typeof window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;
    if (!ctor) {
      setMessages(value => [...value, { id: crypto.randomUUID(), role: 'assistant', content: 'Voice input is not supported in this browser. You can type the same command below.' }]);
      return;
    }
    const instance = new ctor();
    instance.lang = 'en-IN'; instance.interimResults = true; instance.continuous = false;
    instance.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0].transcript).join('');
      setInput(transcript);
      if (Array.from(event.results).some(result => result.isFinal)) setTimeout(() => void sendMessage(transcript), 150);
    };
    instance.onend = () => setListening(false);
    instance.onerror = () => { setListening(false); setMessages(value => [...value, { id: crypto.randomUUID(), role: 'assistant', content: 'I could not hear that clearly. Please try again or type your command.' }]); };
    recognition.current = instance; setListening(true); instance.start();
  }

  async function confirmAction() {
    if (!action || busy) return;
    setBusy(true);
    try {
      if (action.type === 'CREATE_INVOICE') {
        const invoice = await request<{ id: string; number: string }>('/invoices', { method: 'POST', body: JSON.stringify(action.payload) });
        setMessages(value => [...value, { id: crypto.randomUUID(), role: 'assistant', content: `Invoice ${invoice.number} was created successfully for ${action.preview.customer}.` }]);
        setCompleted(true);
      } else {
        await request(`/portal/quotations/${action.payload.quoteId}/message`, { method: 'POST', body: JSON.stringify({ message: action.payload.message }) });
        setMessages(value => [...value, { id: crypto.randomUUID(), role: 'assistant', content: `Your comment was posted successfully on quotation ${action.preview.quoteNumber}.` }]);
        setCompleted(false);
      }
      setAction(null); await onChanged?.();
    } catch (error) {
      setMessages(value => [...value, { id: crypto.randomUUID(), role: 'assistant', content: error instanceof Error ? error.message : 'I could not create the invoice.' }]);
    } finally { setBusy(false); }
  }

  const suggestions = internal ? ['Summarize open invoices', 'Show at-risk deals', ...(canCreate ? ['Create an invoice for a customer'] : [])] : ['What is DealOS?', 'How do approvals work?', 'Tell me about invoicing'];
  return <div className={`deal-assistant ${internal ? 'internal' : 'public'} ${open ? 'is-open' : ''}`}>
    {!open && <button className="assistant-launcher" onClick={() => setOpen(true)} aria-label="Open DealOS Assistant"><Sparkles/><span>{internal ? 'Ask DealOS' : 'Chat with us'}</span></button>}
    {open && <section className="assistant-panel" aria-label="DealOS Assistant">
      <header><span className="assistant-mark"><Bot/></span><div><b>{internal ? 'DealOS Copilot' : 'DealOS Guide'}</b><small><i/> Powered by Groq · English</small></div><button onClick={() => setOpen(false)} aria-label="Minimize assistant"><ChevronDown/></button><button onClick={() => setOpen(false)} aria-label="Close assistant"><X/></button></header>
      <div className="assistant-mode"><ShieldCheck/><span><b>{internal ? 'Workspace mode' : 'Public mode'}</b>{internal ? ' Permission-aware read & write' : ' General product guidance only'}</span></div>
      <div className="assistant-thread" aria-live="polite">
        <article className="assistant-message bot"><span><Bot/></span><p>{greeting}</p></article>
        {!messages.length && <div className="assistant-suggestions">{suggestions.map(suggestion => <button key={suggestion} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}</div>}
        {messages.map(message => <article key={message.id} className={`assistant-message ${message.role}`}><span>{message.role === 'assistant' ? <Bot/> : workspace?.user.name.slice(0, 1).toUpperCase() || 'You'}</span><p>{message.content}</p></article>)}
        {busy && <article className="assistant-message bot typing"><span><Bot/></span><p><i/><i/><i/></p></article>}
        {action && <div className="assistant-action-card"><div className="assistant-action-title"><span><Check/></span><div><b>{action.type === 'CREATE_INVOICE' ? 'Invoice ready for review' : 'Comment ready for review'}</b><small>{action.summary}</small></div></div>{action.type === 'CREATE_INVOICE' ? <dl><div><dt>Customer</dt><dd>{action.preview.customer}</dd></div><div><dt>Due</dt><dd>{action.preview.dueAt}</dd></div>{action.preview.lines.map((line, index) => <div key={`${line.product}-${index}`}><dt>{line.product} × {line.quantity}</dt><dd>{money(line.total)}</dd></div>)}<div className="assistant-total"><dt>Total incl. tax</dt><dd>{money(action.preview.total)}</dd></div></dl> : <dl><div><dt>Quotation</dt><dd>{action.preview.quoteNumber}</dd></div><div><dt>Customer</dt><dd>{action.preview.customer}</dd></div><div><dt>Comment</dt><dd>{action.preview.message}</dd></div></dl>}<div className="assistant-action-buttons"><button onClick={() => setAction(null)}>Cancel</button><button onClick={() => void confirmAction()} disabled={busy}>{action.label}</button></div></div>}
        {completed && <button className="assistant-open-invoices" onClick={() => { window.history.pushState({}, '', '/app?screen=invoices'); window.dispatchEvent(new PopStateEvent('popstate')); setOpen(false); }}>Open invoices</button>}
        <div ref={endRef}/>
      </div>
      <form className="assistant-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void sendMessage(input); }}><button type="button" className={listening ? 'listening' : ''} onClick={toggleVoice} aria-label={listening ? 'Stop voice input' : 'Start voice input'}>{listening ? <MicOff/> : <Mic/>}</button><input value={input} onChange={event => setInput(event.target.value)} placeholder={listening ? 'Listening…' : internal ? 'Ask or give a command…' : 'Ask about DealOS…'} disabled={busy}/><button type="submit" disabled={!input.trim() || busy} aria-label="Send message">{busy ? <LoaderCircle className="spin"/> : <Send/>}</button></form>
      <footer>{internal ? 'Actions respect your role and require confirmation.' : 'No workspace data is available in public mode.'}</footer>
    </section>}
  </div>;
}
