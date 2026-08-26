export function isVoiceOfferInitiator(selfId, peerId) {
  const self = String(selfId || "");
  const peer = String(peerId || "");
  return Boolean(self && peer && self < peer);
}
