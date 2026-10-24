.. _require:

Requirements
============

Runtime
-------

BetterMyAdmin runs either:

* as the Docker image ``ghcr.io/cb-sigma/better-myadmin`` (see :ref:`docker`),
  which brings everything it needs; or
* from a checkout (see :ref:`checkout`), which needs `Node.js
  <https://nodejs.org/>`_ 22.5 or newer and `pnpm <https://pnpm.io/>`_.

BetterMyAdmin is one Node.js process that serves both the web application and
its API. It needs **no PHP, no PHP extensions and no web server** (Apache,
nginx, :term:`IIS`): everything phpMyAdmin takes from PHP extensions (sessions,
encryption, compression, image thumbnails, XML and OpenDocument parsing,
reCAPTCHA and version checks) is built in. A reverse proxy in front of it is
optional; it is the usual place to terminate TLS (see :ref:`securing`).

.. seealso:: :ref:`authentication_modes`

Database
--------

BetterMyAdmin supports MySQL-compatible databases.

* MySQL 5.5 or newer
* MariaDB 5.5 or newer

.. seealso:: :config:option:`$cfg['MysqlMinVersion']`, :ref:`faq1_17`

Web browser
-----------

To access BetterMyAdmin you need a current web browser (a recent Firefox,
Chrome, Edge or Safari) with cookies and JavaScript enabled.
