// Orchestrates one "Compare with Office Records" comparison: fetches the
// six Google Sheets, parses them, and cross-checks against MoneyManager's
// own local data (via MoneyManagerSource) - ported from
// moneymanager-standalone-src/src/business/reports/compare-office-records.ts's
// compareOfficeRecords(), scoped to what's covered here (see the header
// comment on lib/moneymanager/rules/officeRecordsComparison.ts for exactly
// which facets are implemented vs deferred).
import * as XLSX from 'xlsx';
import type { MoneyManagerSource } from '../client/source';
import { fetchCsvRows, fetchWorkbook, toExportUrl } from './fetch';
import {
  everyIsoDateInRange,
  matchWithdrawalsForDate,
  parseCashOutSheet,
  parseDailySummarySheet,
  parseZoneCsv,
  ZONE_NAMES,
  type OfficeDailySummaryDay,
  type WithdrawalMatchResult,
  type ZoneName,
} from './parse';
import type { OfficeRecordsUrls } from './config';

export type ZoneDetailRow = {
  zone: ZoneName;
  date: string;
  officeMinor: number | null;
  appMinor: number;
  diffMinor: number | null;
};

export type CompareOfficeRecordsResult = {
  dateFrom: string;
  dateTo: string;
  zoneDetail: ZoneDetailRow[];
  withdrawalMatching: (WithdrawalMatchResult & { date: string })[];
  /** Present only when the Master Workbook's DAILY SUMMARY sheet had a row
   * for that date - kept for evidence/reporting even though this phase
   * doesn't turn it into its own findings (see the "closing balance
   * structure" deferral note in officeRecordsComparison.ts). */
  officeDailySummaryByDate: Map<string, OfficeDailySummaryDay>;
};

export async function runOfficeRecordsComparison(
  reader: MoneyManagerSource,
  urls: OfficeRecordsUrls,
  dateFrom: string,
  dateTo: string,
  fetchImpl: typeof fetch,
  retryDelaysMs?: number[]
): Promise<CompareOfficeRecordsResult> {
  const zoneUrlByName: Record<ZoneName, string> = {
    'ZONE A': urls.zoneA,
    'ZONE B': urls.zoneB,
    'ZONE C': urls.zoneC,
    'ZONE D': urls.zoneD,
    'ZONE E': urls.zoneE,
  };

  // ---- Fetch everything ----
  const zoneTotals = new Map<ZoneName, Map<string, number>>();
  for (const zone of ZONE_NAMES) {
    const csvRows = await fetchCsvRows(toExportUrl(zoneUrlByName[zone], 'csv'), zone, fetchImpl, retryDelaysMs);
    zoneTotals.set(zone, parseZoneCsv(csvRows, dateFrom, dateTo));
  }

  const workbook = await fetchWorkbook(toExportUrl(urls.masterWorkbook, 'xlsx'), fetchImpl, retryDelaysMs);
  const dailySummarySheet = workbook.Sheets['DAILY SUMMARY'];
  const cashOutSheet = workbook.Sheets['CASH OUT '] ?? workbook.Sheets['CASH OUT'];
  if (!dailySummarySheet) {
    throw new Error(`The master workbook has no "DAILY SUMMARY" sheet (it has: ${workbook.SheetNames.join(', ')}).`);
  }
  if (!cashOutSheet) {
    throw new Error(`The master workbook has no "CASH OUT" sheet (it has: ${workbook.SheetNames.join(', ')}).`);
  }

  const dailySummaryRows = XLSX.utils.sheet_to_json(dailySummarySheet, { header: 1, raw: false, defval: '' }) as string[][];
  const cashOutRows = XLSX.utils.sheet_to_json(cashOutSheet, { header: 1, raw: false, defval: '' }) as string[][];
  const officeDailySummary = parseDailySummarySheet(dailySummaryRows, dateFrom, dateTo);
  const officeCashOut = parseCashOutSheet(cashOutRows, dateFrom, dateTo);

  // ---- App-side data ----
  const appZoneRows = reader.zoneCollectionsByDate(dateFrom, dateTo);
  const appZoneMinorByZoneDate = new Map<string, number>();
  for (const r of appZoneRows) appZoneMinorByZoneDate.set(`${r.zoneName}|${r.entryDate}`, r.amountMinor);

  const appWithdrawalRows = reader.withdrawalsForMatching(dateFrom, dateTo);
  const appWithdrawalsByDate = new Map<
    string,
    { customerName: string; amountMinor: number; commissionMinor: number; hasStructuredRecord: boolean }[]
  >();
  for (const r of appWithdrawalRows) {
    if (!appWithdrawalsByDate.has(r.entryDate)) appWithdrawalsByDate.set(r.entryDate, []);
    appWithdrawalsByDate.get(r.entryDate)!.push({
      customerName: r.customerName,
      amountMinor: r.amountMinor,
      commissionMinor: r.commissionMinor,
      hasStructuredRecord: r.hasStructuredRecord,
    });
  }

  const dates = everyIsoDateInRange(dateFrom, dateTo);

  // ---- Zone Detail ----
  const zoneDetail: ZoneDetailRow[] = [];
  for (const zone of ZONE_NAMES) {
    for (const date of dates) {
      const officeMinor = zoneTotals.get(zone)?.get(date) ?? null;
      const appMinor = appZoneMinorByZoneDate.get(`${zone}|${date}`) ?? 0;
      zoneDetail.push({ zone, date, officeMinor, appMinor, diffMinor: officeMinor === null ? null : appMinor - officeMinor });
    }
  }

  // ---- Withdrawal Matching ----
  const withdrawalMatching: (WithdrawalMatchResult & { date: string })[] = [];
  for (const date of dates) {
    const officeRows = officeCashOut.get(date) ?? [];
    const appRows = appWithdrawalsByDate.get(date) ?? [];
    const matched = matchWithdrawalsForDate(officeRows, appRows);
    for (const row of matched) withdrawalMatching.push({ ...row, date });
  }

  return { dateFrom, dateTo, zoneDetail, withdrawalMatching, officeDailySummaryByDate: officeDailySummary };
}
