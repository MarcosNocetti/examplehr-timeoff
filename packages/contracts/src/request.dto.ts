import { RequestStatus, SagaState } from './enums';

export interface CreateRequestDto {
  locationId: string;
  startDate: string; // ISO date
  endDate: string;
  idempotencyKey: string;
}

export interface TimeOffRequestDto {
  id: string;
  employeeId: string;
  locationId: string;
  startDate: string;
  endDate: string;
  days: string; // decimal as string
  status: RequestStatus;
  sagaState: SagaState;
  createdAt: string;
  updatedAt: string;
}

export interface RejectRequestDto {
  reason?: string;
}

export interface ForceFailRequestDto {
  reason: string;
}
