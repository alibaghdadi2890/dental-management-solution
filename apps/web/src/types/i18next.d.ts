import 'i18next';
import type admin from '../locales/en/admin.json';
import type auth from '../locales/en/auth.json';
import type billing from '../locales/en/billing.json';
import type catalog from '../locales/en/catalog.json';
import type common from '../locales/en/common.json';
import type patients from '../locales/en/patients.json';
import type settings from '../locales/en/settings.json';
import type shell from '../locales/en/shell.json';
import type visits from '../locales/en/visits.json';

// English is the reference language: keys are type-checked against it.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      shell: typeof shell;
      auth: typeof auth;
      admin: typeof admin;
      patients: typeof patients;
      billing: typeof billing;
      visits: typeof visits;
      catalog: typeof catalog;
      settings: typeof settings;
    };
  }
}
