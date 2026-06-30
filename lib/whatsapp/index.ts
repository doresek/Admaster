// lib/whatsapp/index.ts — public surface of the WhatsApp (InforU) send layer.
export * from './types';
export {
  sendViaInforU,
  buildInforUPayload,
  resolveMode,
  hasInforUCreds,
  type InforUPayload,
} from './inforu';
export { sendWhatsApp } from './send';
