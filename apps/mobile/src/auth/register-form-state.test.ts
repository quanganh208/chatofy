import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateNewPassword, validateRegistration } from './register-form-state.ts';

const valid = {
  name: 'An',
  email: 'an@example.com',
  password: 'a long password',
  confirmPassword: 'a long password',
};

describe('validateRegistration', () => {
  it('accepts a complete form', () => {
    assert.equal(validateRegistration(valid), null);
  });

  it('asks for every field', () => {
    assert.equal(validateRegistration({ ...valid, name: '  ' }), 'mobile.auth.fillAllFields');
    assert.equal(validateRegistration({ ...valid, email: '' }), 'mobile.auth.fillAllFields');
    assert.equal(validateRegistration({ ...valid, password: '' }), 'mobile.auth.fillAllFields');
  });

  it('rejects a malformed address and an overlong name', () => {
    assert.equal(
      validateRegistration({ ...valid, email: 'not-an-email' }),
      'mobile.auth.invalidEmail',
    );
    assert.equal(
      validateRegistration({ ...valid, name: 'x'.repeat(500) }),
      'mobile.auth.nameTooLong',
    );
  });

  it('applies the API password bounds and the confirmation', () => {
    assert.equal(
      validateRegistration({ ...valid, password: 'short', confirmPassword: 'short' }),
      'web.auth.passwordTooShort',
    );
    assert.equal(
      validateRegistration({
        ...valid,
        password: 'x'.repeat(200),
        confirmPassword: 'x'.repeat(200),
      }),
      'mobile.auth.passwordTooLong',
    );
    assert.equal(
      validateRegistration({ ...valid, confirmPassword: 'different one' }),
      'mobile.auth.passwordMismatch',
    );
  });
});

describe('validateNewPassword', () => {
  it('shares the registration rules', () => {
    assert.equal(validateNewPassword('a long password', 'a long password'), null);
    assert.equal(validateNewPassword('', ''), 'mobile.auth.fillAllFields');
    assert.equal(validateNewPassword('short', 'short'), 'web.auth.passwordTooShort');
    assert.equal(
      validateNewPassword('a long password', 'another one'),
      'mobile.auth.passwordMismatch',
    );
  });
});
