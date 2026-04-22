export interface BalanceDto {
  employeeId: string;
  locationId: string;
  totalDays: string;     // decimal as string for safety
  availableDays: string;
  version: number;
  hcmLastSeenAt: string; // ISO
}
