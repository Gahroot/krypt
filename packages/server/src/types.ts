/**
 * Server-local re-export of the wire protocol. The canonical definition lives in @maple/shared/net
 * so the browser client and this server share one source of truth without bundling server code.
 */
export { MessageType, type InputData, type MessageTypeValue } from "@maple/shared";
