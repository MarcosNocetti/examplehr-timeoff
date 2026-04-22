export interface HcmBalanceRow {
  employeeId: string;
  locationId: string;
  totalDays: string; // decimal as string
  hcmTimestamp: string; // ISO
}

export interface HcmBatchPayload {
  generatedAt: string;
  rows: HcmBalanceRow[];
}

export interface HcmRealtimeDelta {
  employeeId: string;
  locationId: string;
  newTotal: string; // decimal as string
  hcmTimestamp: string;
}

export interface HcmReserveRequest {
  employeeId: string;
  locationId: string;
  days: string; // decimal as string
  reservationId: string;
}

export interface HcmConfirmRequest {
  reservationId: string;
}

export interface HcmReleaseRequest {
  reservationId: string;
}
