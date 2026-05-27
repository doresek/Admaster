'use client';
import { type ReactNode, type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

// ─── SPINNER ─────────────────────────────────────────────────
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <div
      className="border-2 border-white/20 border-t-white rounded-full animate-spin flex-shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

// ─── BUTTON ──────────────────────────────────────────────────
type BtnVariant = 'primary' | 'violet' | 'green' | 'amber' | 'gold' | 'ghost' | 'outline' | 'red';

const variantCls: Record<BtnVariant, string> = {
  primary: 'bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white shadow-[0_4px_14px_rgba(10,122,255,0.3)]',
  violet:  'bg-[#6D28D9] hover:brightness-110 text-white',
  green:   'bg-[#059669] hover:brightness-110 text-white',
  amber:   'bg-[#D97706] hover:brightness-110 text-white',
  gold:    'bg-[#B8953A] hover:bg-[#D4AF55] text-black font-bold',
  ghost:   'bg-[#162030] border border-[#1E2F42] text-[#6B8FA8] hover:border-[#2A4158] hover:text-[#D9E8F5]',
  outline: 'border border-[#2A4158] text-[#6B8FA8] hover:border-[#0A7AFF] hover:text-[#3D9FFF]',
  red:     'bg-red-900/20 border border-red-500/25 text-red-400 hover:bg-red-900/30',
};

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
  full?: boolean;
}

export function Btn({ variant='primary', size='md', loading, children, full, className, disabled, ...props }: BtnProps) {
  const sizeCls = { xs: 'px-2.5 py-1 text-[11px]', sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-[13px]', lg: 'px-5 py-3 text-[14px]' }[size];
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none',
        variantCls[variant], sizeCls, full && 'w-full', className
      )}
    >
      {loading && <Spinner size={13} />}
      {children}
    </button>
  );
}

// ─── CARD ────────────────────────────────────────────────────
export function Card({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={clsx('bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 transition-colors hover:border-[#2A4158]', className)} style={style}>
      {children}
    </div>
  );
}

// ─── CARD LABEL ───────────────────────────────────────────────
export function CardLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-3">
      <div className="w-0.5 h-3 bg-[#0A7AFF] rounded-full" />
      {children}
    </div>
  );
}

// ─── CHIP ─────────────────────────────────────────────────────
export function Chip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
        active
          ? 'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]'
          : 'border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158] hover:text-[#D9E8F5]'
      )}
    >
      {label}
    </button>
  );
}

// ─── INPUT ────────────────────────────────────────────────────
interface InputProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}

export function Input({ label, value, onChange, placeholder, type='text', required }: InputProps) {
  return (
    <div className="mb-3">
      {label && <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">{label}</label>}
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-[13px] text-[#D9E8F5] outline-none focus:border-[#0A7AFF] focus:bg-[#111A24] placeholder-[#2E4459] transition-colors"
        dir={type === 'email' || type === 'password' ? 'ltr' : 'rtl'}
      />
    </div>
  );
}

// ─── TEXTAREA ─────────────────────────────────────────────────
export function Textarea({ label, value, onChange, placeholder, rows=4 }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <div className="mb-3">
      {label && <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">{label}</label>}
      <textarea
        value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} rows={rows}
        className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-[13px] text-[#D9E8F5] outline-none focus:border-[#0A7AFF] focus:bg-[#111A24] placeholder-[#2E4459] transition-colors resize-y"
        dir="rtl"
      />
    </div>
  );
}

// ─── SELECT ───────────────────────────────────────────────────
export function Select({ label, value, onChange, options }: { label?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="mb-3">
      {label && <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">{label}</label>}
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-[13px] text-[#D9E8F5] outline-none focus:border-[#0A7AFF] transition-colors"
        dir="rtl"
      >
        {options.map(o => <option key={o.value} value={o.value} className="bg-[#162030]">{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── ALERT ────────────────────────────────────────────────────
type AlertType = 'blue' | 'green' | 'amber' | 'red';
const alertCls: Record<AlertType, string> = {
  blue:  'bg-[#0A7AFF]/10 border-[#0A7AFF]/20 text-[#7AC0FF]',
  green: 'bg-[#059669]/10 border-[#059669]/20 text-[#34D399]',
  amber: 'bg-[#D97706]/10 border-[#D97706]/20 text-[#D97706]',
  red:   'bg-red-900/10 border-red-500/20 text-red-400',
};

export function Alert({ type='blue', children, className }: { type?: AlertType; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('px-3 py-2.5 rounded-lg border text-[12.5px] flex gap-2 items-start leading-relaxed mb-3', alertCls[type], className)}>
      {children}
    </div>
  );
}

// ─── OUTPUT BOX ────────────────────────────────────────────────
export function OutputBox({ text, className }: { text: string; className?: string }) {
  return (
    <div className={clsx('bg-[#162030] border border-[#0A7AFF] rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed text-[#D9E8F5] animate-[fadeUp_.3s_ease]', className)}>
      {text}
    </div>
  );
}

// ─── COST BADGE ───────────────────────────────────────────────
export function CostBadge({ cost }: { cost: number }) {
  return (
    <span className="inline-flex items-center gap-1 bg-[#B8953A]/10 border border-[#B8953A]/25 text-[#D4AF55] text-[11px] font-bold px-2 py-0.5 rounded-full">
      ⚡{cost}
    </span>
  );
}

// ─── PAGE HEADER ─────────────────────────────────────────────
export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        {eyebrow && <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-1">{eyebrow}</div>}
        <h1 className="text-2xl font-bold text-[#D9E8F5] mb-1">{title}</h1>
        {sub && <p className="text-[#6B8FA8] text-sm">{sub}</p>}
      </div>
      {right && <div className="flex items-center gap-2 flex-shrink-0">{right}</div>}
    </div>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────
export function StatCard({ icon, value, label, glow }: { icon: string; value: string | number; label: string; glow?: string }) {
  return (
    <div className="relative bg-[#111A24] border border-[#1E2F42] rounded-lg p-3.5 overflow-hidden">
      <div className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-60" style={{ background: `radial-gradient(circle at top right, ${glow || 'rgba(10,122,255,0.12)'}, transparent 70%)` }} />
      <div className="absolute top-2.5 left-2.5 text-[18px] opacity-20">{icon}</div>
      <div className="font-mono text-2xl font-medium text-[#D9E8F5] leading-none mb-1">{value}</div>
      <div className="text-[11px] text-[#6B8FA8]">{label}</div>
    </div>
  );
}

// ─── TABS ─────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex border-b border-[#1E2F42] mb-4">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={clsx(
            'px-4 py-2 text-[12.5px] font-medium border-b-2 -mb-px transition-all',
            active === t.id
              ? 'text-[#3D9FFF] border-[#3D9FFF]'
              : 'text-[#2E4459] border-transparent hover:text-[#6B8FA8]'
          )}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── COPY BUTTON ─────────────────────────────────────────────
export function CopyBtn({ text, label = '📋 העתק', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Btn variant="ghost" size="sm" onClick={copy} className={className}>
      {copied ? '✓ הועתק!' : label}
    </Btn>
  );
}

// need useState for CopyBtn
import { useState } from 'react';
