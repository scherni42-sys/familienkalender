// E-Rechnung: aus einem erfassten Beleg eine XRechnung (UBL 2.1, EN 16931, XRechnung 3.0) erzeugen.
// Alle Summen werden aus den Netto-Zeilen berechnet, damit die Rechenregeln der Norm (BR-CO-…) aufgehen.
import type { Party, Receipt } from './cash';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const a = (n: number) => r2(n).toFixed(2);
const x = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const el = (tag: string, v: string | undefined, attrs = '') => v ? `<${tag}${attrs}>${x(v)}</${tag}>` : '';
const iban0 = (e: { seller?: Party }) => e.seller?.iban?.replace(/\s+/g, '') ?? '';
const eur = (tag: string, n: number) => `<${tag} currencyID="EUR">${a(n)}</${tag}>`;

export interface XLine { name: string; qty: number; net: number; rate: number }
export interface XCheck { missing: string[]; lines: XLine[]; note: string }

// Netto-Zeilen bilden: aus den Positionen, sonst eine Zeile je Steuersatz aus der MwSt-Aufstellung
export function xLines(rc: Receipt): { lines: XLine[]; note: string } {
  const one = rc.taxes.length === 1 ? rc.taxes[0].rate : null;
  const its = rc.items.map(i => {
    const rate = i.vat || one || 0;
    return { name: i.name || 'Position', qty: i.qty || 1, net: r2(rc.items_net ? i.price : i.price / (1 + rate / 100)), rate };
  });
  const gross = (ls: XLine[]) => { const m = new Map<number, number>(); for (const l of ls) m.set(l.rate, (m.get(l.rate) ?? 0) + l.net); return [...m].reduce((s, [rt, n]) => s + r2(n) + r2(n * rt / 100), 0); };
  if (its.length && Math.abs(gross(its) - rc.total) <= 0.05) return { lines: its, note: '' };
  if (rc.taxes.length) {
    const ls = rc.taxes.map(t => ({ name: `Lieferungen und Leistungen ${String(t.rate).replace('.', ',')} % laut Rechnung`, qty: 1, net: r2(t.net), rate: t.rate }));
    return { lines: ls, note: its.length ? 'Die Positionen passen nicht genau zur Summe. Exportiert wird je Steuersatz eine Zeile aus der MwSt-Aufstellung.' : '' };
  }
  return { lines: its, note: its.length ? 'Die Positionen ergeben nicht genau den Rechnungsbetrag. Bitte Beträge und Steuersätze prüfen.' : '' };
}

// Pflichtangaben prüfen (XRechnung: BR-DE-…, EN 16931: BR-…)
export function xCheck(rc: Receipt): XCheck {
  const e = rc.einv ?? {}, s = e.seller, b = e.buyer;
  const { lines, note } = xLines(rc);
  const miss: string[] = [];
  if (!rc.invoice_no.trim()) miss.push('Rechnungsnummer');
  if (!s?.name && !rc.merchant) miss.push('Verkäufer: Name');
  if (!s?.street) miss.push('Verkäufer: Straße');
  if (!s?.zip) miss.push('Verkäufer: PLZ');
  if (!s?.city) miss.push('Verkäufer: Ort');
  if (!s?.vat_id && !s?.tax_no) miss.push('Verkäufer: USt-IdNr. oder Steuernummer');
  if (!s?.email) miss.push('Verkäufer: E-Mail');
  if (!s?.phone) miss.push('Verkäufer: Telefon');
  if (!b?.name) miss.push('Käufer: Name');
  if (!b?.email) miss.push('Käufer: E-Mail');
  if (!b?.zip) miss.push('Käufer: PLZ');
  if (!b?.city) miss.push('Käufer: Ort');
  if (!lines.length) miss.push('Positionen oder MwSt-Aufstellung');
  if (lines.some(l => !l.rate && rc.taxes.some(t => t.rate))) miss.push('MwSt-Satz bei jeder Position');
  return { missing: miss, lines, note };
}

const party = (p: Party | undefined, fallbackName: string, seller: boolean) => {
  const q = p ?? ({} as Party), country = (q.country || 'DE').toUpperCase().slice(0, 2);
  return `<cac:Party>
      ${q.email ? `<cbc:EndpointID schemeID="EM">${x(q.email)}</cbc:EndpointID>` : ''}
      ${seller && !q.vat_id && q.tax_no ? `<cac:PartyIdentification><cbc:ID>${x(q.tax_no)}</cbc:ID></cac:PartyIdentification>` : ''}
      <cac:PostalAddress>${el('cbc:StreetName', q.street)}${el('cbc:CityName', q.city)}${el('cbc:PostalZone', q.zip)}<cac:Country><cbc:IdentificationCode>${x(country)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      ${q.vat_id ? `<cac:PartyTaxScheme><cbc:CompanyID>${x(q.vat_id.replace(/\s+/g, ''))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      ${seller && q.tax_no ? `<cac:PartyTaxScheme><cbc:CompanyID>${x(q.tax_no)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity><cbc:RegistrationName>${x(q.name || fallbackName)}</cbc:RegistrationName></cac:PartyLegalEntity>
      ${seller ? `<cac:Contact><cbc:Name>${x(q.contact || q.name || fallbackName)}</cbc:Name>${el('cbc:Telephone', q.phone)}${el('cbc:ElectronicMail', q.email)}</cac:Contact>` : ''}
    </cac:Party>`;
};

export function xrechnung(rc: Receipt): string {
  const e = rc.einv ?? {}, { lines } = xLines(rc);
  const issue = rc.bought_at.slice(0, 10);
  const groups = new Map<number, number>();
  for (const l of lines) groups.set(l.rate, r2((groups.get(l.rate) ?? 0) + l.net));
  const net = r2(lines.reduce((s, l) => s + l.net, 0));
  const subs = [...groups].sort((p, q) => q[0] - p[0]).map(([rate, base]) => ({ rate, base, tax: r2(base * rate / 100) }));
  const tax = r2(subs.reduce((s, t) => s + t.tax, 0));
  const incl = r2(net + tax);
  // Rundungsdifferenz zum Rechnungsbetrag (nur Cents) als Rundungsbetrag ausweisen
  const round = Math.abs(rc.total - incl) <= 0.05 ? r2(rc.total - incl) : 0;
  // 0 %: mit MwSt-Aufstellung „Z“ (Nullsatz), ohne jede Steuer Kleinunternehmer „E“ (§ 19 UStG)
  const cat = (rate: number) => rate > 0 ? 'S' : rc.taxes.some(t => t.rate > 0) || lines.some(l => l.rate > 0) ? 'Z' : 'E';
  const why = (rate: number) => cat(rate) === 'E' ? '<cbc:TaxExemptionReason>Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG</cbc:TaxExemptionReason>' : '';
  const pm = iban0(e) ? '58' : /bar/i.test(rc.payment) ? '10' : /karte|visa|master|ec|giro|apple|google/i.test(rc.payment) ? '48' : '1';
  const iban = iban0(e);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${x(rc.invoice_no.trim() || 'ohne-Nummer')}</cbc:ID>
  <cbc:IssueDate>${issue}</cbc:IssueDate>
  ${e.due ? `<cbc:DueDate>${x(e.due)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${rc.note ? `<cbc:Note>${x(rc.note.slice(0, 1000))}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${x(e.ref || rc.invoice_no || 'n/a')}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    ${party(e.seller, rc.merchant, true)}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    ${party(e.buyer, '', false)}
  </cac:AccountingCustomerParty>
  ${e.service ? `<cac:Delivery><cbc:ActualDeliveryDate>${x(e.service)}</cbc:ActualDeliveryDate></cac:Delivery>` : ''}
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${pm}</cbc:PaymentMeansCode>
    ${iban ? `<cac:PayeeFinancialAccount><cbc:ID>${x(iban)}</cbc:ID>${e.seller?.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${x(e.seller.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}</cac:PayeeFinancialAccount>` : ''}
  </cac:PaymentMeans>
  <cac:TaxTotal>
    ${eur('cbc:TaxAmount', tax)}
    ${subs.map(t => `<cac:TaxSubtotal>${eur('cbc:TaxableAmount', t.base)}${eur('cbc:TaxAmount', t.tax)}<cac:TaxCategory><cbc:ID>${cat(t.rate)}</cbc:ID><cbc:Percent>${t.rate}</cbc:Percent>${why(t.rate)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join('\n    ')}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    ${eur('cbc:LineExtensionAmount', net)}
    ${eur('cbc:TaxExclusiveAmount', net)}
    ${eur('cbc:TaxInclusiveAmount', incl)}
    ${round ? eur('cbc:PayableRoundingAmount', round) : ''}
    ${eur('cbc:PayableAmount', r2(incl + round))}
  </cac:LegalMonetaryTotal>
${lines.map((l, i) => `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${l.net < 0 ? -Math.abs(+l.qty.toFixed(3)) : Math.abs(+l.qty.toFixed(3))}</cbc:InvoicedQuantity>
    ${eur('cbc:LineExtensionAmount', l.net)}
    <cac:Item><cbc:Name>${x(l.name.slice(0, 300))}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${cat(l.rate)}</cbc:ID><cbc:Percent>${l.rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price>${eur('cbc:PriceAmount', Math.abs(l.net))}<cbc:BaseQuantity unitCode="C62">${Math.abs(+l.qty.toFixed(3)) || 1}</cbc:BaseQuantity></cac:Price>
  </cac:InvoiceLine>`).join('\n')}
</ubl:Invoice>
`;
}
