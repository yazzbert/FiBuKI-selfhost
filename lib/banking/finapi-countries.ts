import { COUNTRIES } from "@/lib/data/countries";

// finAPI should be available across all EU countries.
export const FINAPI_EU_COUNTRY_CODES: readonly string[] = [
  "DE",
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

// Keep Switzerland for existing DACH users while expanding to EU coverage.
export const FINAPI_SUPPORTED_COUNTRY_CODES: readonly string[] = [
  ...FINAPI_EU_COUNTRY_CODES,
  "CH",
] as const;

const countryNames = new Map<string, string>(
  COUNTRIES.map((country) => [country.code, country.name] as const)
);

export const FINAPI_COUNTRY_OPTIONS = FINAPI_SUPPORTED_COUNTRY_CODES.map((code) => ({
  code,
  name: countryNames.get(code) || code,
}));
