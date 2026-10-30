.. _2fa:

Two-factor authentication
=========================

.. versionadded:: 4.8.0

You can configure two-factor authentication to be used when logging in. Every
user can opt-in for the second authentication factor in the
:guilabel:`Settings`. The choice is stored with the user preferences: in the
:ref:`linked-tables` (``pma__userconfig``), with the same contents as in
phpMyAdmin, so that a user's second factor works in both; or, without a
configuration storage, in BetterMyAdmin's local metadata store in
:config:option:`$cfg['DataDir']`.

Everything two-factor authentication needs is built into BetterMyAdmin: there
are no extra packages to install (phpMyAdmin needs composer packages for it).

Authentication Application (2FA)
--------------------------------

Using an application for authentication is a quite common approach based on HOTP and
`TOTP <https://en.wikipedia.org/wiki/Time-based_One-time_Password_Algorithm>`_.
It is based on transmitting a private key from BetterMyAdmin to the authentication
application and the application is then able to generate one time codes based
on this key. The easiest way to enter the key in to the application from BetterMyAdmin is
through scanning a QR code. The application lists the account as
"BetterMyAdmin" followed by the host name.

There are dozens of applications available for mobile phones to implement these
standards, the most widely used include:

* `FreeOTP for iOS, Android and Pebble <https://freeotp.github.io/>`_
* `Authy for iOS, Android, Chrome, OS X <https://authy.com/>`_
* `Google Authenticator for iOS <https://apps.apple.com/us/app/google-authenticator/id388497605>`_
* `Google Authenticator for Android <https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2>`_
* `LastPass Authenticator for iOS, Android, OS X, Windows <https://lastpass.com/auth/>`_

Hardware Security Key (WebAuthn/FIDO2)
--------------------------------------

Using hardware tokens is considered to be more secure than a software based
solution. BetterMyAdmin supports `WebAuthn/FIDO2
<https://en.wikipedia.org/wiki/WebAuthn>`_ security keys and passkeys, such as
a YubiKey. WebAuthn needs the page to be served over HTTPS (or from
``localhost``).

There are several manufacturers of these tokens, for example:

* `Yubico security keys <https://www.yubico.com/>`_
* `HyperFIDO <https://www.hypersecu.com/hyperfido>`_
* `Trezor Hardware Wallet <https://trezor.io/>`_
* `List of Two Factor Auth (2FA) Dongles <https://www.dongleauth.com/dongles/>`_

Hardware Security Key (FIDO U2F)
--------------------------------

phpMyAdmin also offers a FIDO U2F backend, based on a JavaScript API that
browsers have removed. BetterMyAdmin never offers it (it is listed as missing
its dependency, like phpMyAdmin without the package); use WebAuthn instead,
which works with the same keys.

.. _simple2fa:

Simple two-factor authentication
--------------------------------

This authentication is included for testing and demonstration purposes only as
it really does not provide two-factor authentication, it just asks the user to confirm login by
clicking on the button.

It should not be used in the production and is disabled unless
:config:option:`$cfg['DBG']['simple2fa']` is set.
