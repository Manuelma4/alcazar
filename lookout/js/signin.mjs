// Lookout · sign-in: shown in place of any view while Gatehouse wants the
// operator. The token goes to Gatehouse once, in a POST body, and comes back
// as an HttpOnly session cookie: it is never stored by this page.

import { h, mount } from './dom.mjs';
import { icon } from './icons.mjs';
import { t } from './strings.mjs';
import { api } from './api.mjs';
import { announce } from './live.mjs';
import { banner, button, card, errorBanner, inputField, setBusy, viewHeader } from './ui.mjs';

const MIN_TOKEN = 32;

/**
 * @param {{ linkRefused?: boolean, onSignedIn: (session: object) => void }} options
 */
export function renderSignIn({ linkRefused = false, onSignedIn }) {
  const errorSlot = h('div', { class: 'signin-error' });
  const field = inputField({
    label: t('signin.token'),
    type: 'password',
    hint: t('signin.token.hint'),
    mono: true,
    attrs: { autocomplete: 'current-password', spellcheck: 'false', autocapitalize: 'off', required: true, maxlength: '512' },
    onInput: () => {
      field.input.removeAttribute('aria-invalid');
      mount(errorSlot);
    },
  });
  const submit = button({ label: t('signin.submit'), icon: 'key', variant: 'primary', type: 'submit' });
  let busy = false;

  const form = h('form', {
    class: 'stack signin-form',
    css: { '--stack-gap': '16px' },
    novalidate: true,
    on: {
      submit: async (event) => {
        event.preventDefault();
        if (busy) return;
        const token = field.input.value.trim();
        if (token.length < MIN_TOKEN) {
          field.input.setAttribute('aria-invalid', 'true');
          mount(errorSlot, h('p', { class: 'field-error', role: 'alert' }, icon('alert', { size: 16 }), t('signin.short')));
          field.input.focus();
          return;
        }
        busy = true;
        setBusy(submit, true, t('signin.busy'));
        mount(errorSlot);
        try {
          const session = await api.signIn(token);
          field.input.value = '';
          announce(t('signin.done'));
          onSignedIn(session);
        } catch (error) {
          field.input.setAttribute('aria-invalid', 'true');
          mount(errorSlot, errorBanner(error, { title: t('signin.refused') }));
          field.input.focus();
          field.input.select();
        } finally {
          busy = false;
          setBusy(submit, false);
        }
      },
    },
  }, field.el, h('div', { class: 'row' }, submit), errorSlot);

  const el = h('div', { class: 'view stack signin', css: { '--stack-gap': '24px' } },
    viewHeader({ eyebrow: t('signin.eyebrow'), title: t('signin.title'), lead: t('signin.lead') }),
    linkRefused ? banner({ tone: 'warn', icon: 'alert', role: 'alert', body: t('signin.linkRefused') }) : null,
    h('div', { class: 'grid grid-2-1' },
      card({ title: t('signin.card'), accent: true, body: form }),
      card({
        title: t('signin.where'),
        body: h('ul', { class: 'signin-help stack', css: { '--stack-gap': '12px' } },
          [['terminal', 'signin.where.run'], ['lock', 'signin.where.file'], ['shield', 'signin.where.cookie']].map(([glyph, key]) =>
            h('li', { class: 'signin-help-item' }, icon(glyph, { size: 18 }), h('span', null, t(key))))),
      })));
  return { el, focus: () => field.input.focus({ preventScroll: true }) };
}
