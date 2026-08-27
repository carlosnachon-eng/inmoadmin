import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_PASSWORD_ROLES,
  PASSWORD_RECOVERY_MESSAGE,
  isEligibleInternalProfile,
  recoveryRedirectUrl,
  validateNewPassword,
} from "../lib/authRecovery.mjs";

test("la respuesta de recuperación es neutral", () => {
  assert.match(PASSWORD_RECOVERY_MESSAGE, /^Si existe una cuenta/);
  assert.doesNotMatch(PASSWORD_RECOVERY_MESSAGE, /no existe|encontrada/i);
});

test("solo perfiles internos activos pueden establecer contraseña", () => {
  for (const role_id of INTERNAL_PASSWORD_ROLES) assert.equal(isEligibleInternalProfile({ active: true, role_id }), true);
  assert.equal(isEligibleInternalProfile({ active: false, role_id: "admin" }), false);
  for (const role_id of ["inquilino", "propietario", "condomino"]) assert.equal(isEligibleInternalProfile({ active: true, role_id }), false);
});

test("valida longitud y confirmación", () => {
  assert.match(validateNewPassword("corta", "corta"), /10 caracteres/);
  assert.match(validateNewPassword("suficientemente-larga", "distinta-larga"), /no coinciden/);
  assert.equal(validateNewPassword("suficientemente-larga", "suficientemente-larga"), "");
});

test("genera callback en el mismo origen de Preview", () => {
  assert.equal(recoveryRedirectUrl("https://preview.example.com/"), "https://preview.example.com/auth/reset-password");
});
