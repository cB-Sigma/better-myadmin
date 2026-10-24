.. _security:

Security policy
===============

The BetterMyAdmin developers are putting lot of effort to make BetterMyAdmin as
secure as possible. But still web application like BetterMyAdmin can be
vulnerable to a number of attacks and new ways to exploit are still being
explored. BetterMyAdmin copies phpMyAdmin's security model deliberately and
tightens it where a modern stack allows; the design is described in the
repository's `security architecture
<https://github.com/cB-Sigma/better-myadmin/blob/main/docs/architecture/07-security.md>`_.

BetterMyAdmin is a faithful, well-tested port, but it has not been
independently security-audited yet: put it behind a configuration file and TLS
before exposing it (see :ref:`securing`).

If you think you've found a vulnerability, please see :ref:`reporting-security`.

Typical vulnerabilities
-----------------------

In this section, we will describe typical vulnerabilities, which can appear in
our code base. This list is by no means complete, it is intended to show
typical attack surface.

Cross-site scripting (XSS)
++++++++++++++++++++++++++

When BetterMyAdmin shows a piece of user data, e.g. something inside a user's
database, all html special chars have to be escaped. When this escaping is
missing somewhere a malicious user might fill a database with specially crafted
content to trick an other user of that database into executing something. This
could for example be a piece of JavaScript code that would do any number of
nasty things.

BetterMyAdmin's interface is rendered by React, which escapes all user data by
default. The few places that render HTML (for example the output of some
:ref:`transformations`) go through a sanitizer with phpMyAdmin's allow-list of
tags, and the Content Security Policy forbids inline scripts.

.. seealso::

    `Cross-site scripting on Wikipedia <https://en.wikipedia.org/wiki/Cross-site_scripting>`_

Cross-site request forgery (CSRF)
+++++++++++++++++++++++++++++++++

An attacker would trick a BetterMyAdmin user into clicking on a link to provoke
some action in BetterMyAdmin. This link could either be sent via email or some
random website. If successful this the attacker would be able to perform some
action with the users privileges.

To mitigate this BetterMyAdmin requires a token to be sent with every request
that changes something (the equivalent of phpMyAdmin's ``token`` parameter),
and requests that only read never change anything. The idea is that an
attacker does not poses the currently valid token to include in the presented
link. SQL carried in a link is signed, and a query whose signature does not
verify is not run.

The token is regenerated for every login, so it's generally valid only for
limited time, what makes it harder for attacker to obtain valid one.

.. seealso::

    `Cross-site request forgery on Wikipedia <https://en.wikipedia.org/wiki/Cross-site_request_forgery>`_

SQL injection
+++++++++++++

As the whole purpose of BetterMyAdmin is to preform sql queries, this is not our
first concern. SQL injection is sensitive to us though when it concerns the
mysql control connection. This controlconnection can have additional privileges
which the logged in user does not poses. E.g. access the :ref:`linked-tables`.

User data that is included in (administrative) queries is always quoted (or
sent as a parameter of a prepared statement), and identifiers are quoted with
backticks.

.. seealso::

    `SQL injection on Wikipedia <https://en.wikipedia.org/wiki/SQL_injection>`_

Brute force attack
++++++++++++++++++

phpMyAdmin on its own does not rate limit authentication attempts in any way.
BetterMyAdmin keeps its sessions on the server, so it does: by default, five
failed logins of one (IP address, username) pair within 15 minutes lock that
pair out for 5 minutes (:config:option:`$cfg['LoginRateLimit']`).

You can additionally use Captcha or utilize external tools such as
fail2ban, this is more details described in :ref:`securing`.

.. seealso::

    `Brute force attack on Wikipedia <https://en.wikipedia.org/wiki/Brute-force_attack>`_

.. _reporting-security:

Reporting security issues
-------------------------

Should you find a security issue in the BetterMyAdmin programming code, please
report it privately to the BetterMyAdmin maintainers through the
`BetterMyAdmin repository <https://github.com/cB-Sigma/better-myadmin>`_
in advance before publishing it. This way we can prepare a fix and release the
fix together with your announcement.

If the issue is in phpMyAdmin's behaviour itself (and therefore affects
phpMyAdmin too), please also report it to the `phpMyAdmin security team
<https://www.phpmyadmin.net/security/>`_.

Should you have suggestion on improving BetterMyAdmin to make it more secure,
please report that to our `issue tracker
<https://github.com/cB-Sigma/better-myadmin/issues>`_.
