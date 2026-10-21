import type { components } from './schema'

// Atalhos para os tipos gerados do contrato (openapi.yaml). Não redeclare formatos à mão.
export type Me = components['schemas']['Me']
export type HouseholdRef = components['schemas']['HouseholdRef']
export type Problem = components['schemas']['Problem']
export type Invoice = components['schemas']['Invoice']
export type InvoiceInput = components['schemas']['InvoiceInput']
export type InvoicePatch = components['schemas']['InvoicePatch']
export type Category = components['schemas']['Category']
export type Wallet = components['schemas']['Wallet']
