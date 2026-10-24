.. _setup:

Installation
============

BetterMyAdmin does not apply any special security methods to the MySQL
database server. It is still the system administrator's job to grant
permissions on the MySQL databases properly. BetterMyAdmin's :guilabel:`Users`
page can be used for this.

BetterMyAdmin is one Node.js process that serves the web application and its
API. It needs no PHP and no web server in front of it; put a reverse proxy with
TLS in front of it before exposing it to a network (see :ref:`securing`).

.. _docker:

Installing using Docker
+++++++++++++++++++++++

Released images are published on the GitHub Container Registry:

.. code-block:: sh

    docker run -d -p 8080:80 -e PMA_HOST=mysql.example.org \
        -v bma-data:/var/lib/bettermyadmin ghcr.io/cb-sigma/better-myadmin:latest

then open ``http://localhost:8080``. Pin a release version (``:X.Y.Z``)
instead of ``:latest`` in production.

The image takes the variables of phpMyAdmin's official Docker image, so a
compose file written for the ``phpmyadmin`` image works with the image name
swapped. It keeps its sessions, the generated ``blowfish_secret`` and its local
metadata in the ``/var/lib/bettermyadmin`` volume, runs as the unprivileged
``node`` user and listens on port 80 inside the container (``APACHE_PORT``
changes it).

.. _docker-vars:

Docker environment variables
----------------------------

Every variable of the official phpMyAdmin image works, so a compose file
written for ``phpmyadmin`` runs BetterMyAdmin with only the image name changed.
Each also has a BetterMyAdmin name, which is the one to use in new setups (the
``PMA_`` names stay supported; when both are set, the ``BMA_`` one wins):

.. list-table::
   :header-rows: 1
   :widths: 30 30 40

   * - BetterMyAdmin
     - phpMyAdmin image (also read)
     - Effect
   * - ``BMA_HOST``
     - ``PMA_HOST``
     - the server to log in to (default: the linked ``db``)
   * - ``BMA_PORT``
     - ``PMA_PORT``
     - that server's port
   * - ``BMA_HOST_LABEL``
     - ``PMA_VERBOSE``
     - that server's name in the server list
   * - ``BMA_HOSTS``
     - ``PMA_HOSTS``
     - several servers, comma-separated
   * - ``BMA_PORTS``
     - ``PMA_PORTS``
     - their ports
   * - ``BMA_HOST_LABELS``
     - ``PMA_VERBOSES``
     - their names
   * - ``BMA_SOCKET``
     - ``PMA_SOCKET``
     - a server reached through a socket
   * - ``BMA_SOCKETS``
     - ``PMA_SOCKETS``
     - several socket servers, comma-separated
   * - ``BMA_ARBITRARY_SERVER``
     - ``PMA_ARBITRARY``
     - ``1``: the login form can name any server
   * - ``BMA_USER``
     - ``PMA_USER``
     - config authentication: log in as this user, no login form
   * - ``BMA_PASSWORD``
     - ``PMA_PASSWORD``
     - that user's password
   * - ``BMA_ABSOLUTE_URI``
     - ``PMA_ABSOLUTE_URI``
     - the public URL behind a reverse proxy
   * - ``BMA_STORAGE_DB``
     - ``PMA_PMADB``
     - the configuration storage database (``phpmyadmin``)
   * - ``BMA_CONTROL_HOST``
     - ``PMA_CONTROLHOST``
     - the configuration storage's server
   * - ``BMA_CONTROL_PORT``
     - ``PMA_CONTROLPORT``
     - its port
   * - ``BMA_CONTROL_USER``
     - ``PMA_CONTROLUSER``
     - the control user
   * - ``BMA_CONTROL_PASSWORD``
     - ``PMA_CONTROLPASS``
     - the control user's password
   * - ``BMA_QUERY_HISTORY_DB``
     - ``PMA_QUERYHISTORYDB``
     - keep the SQL history in the configuration storage
   * - ``BMA_QUERY_HISTORY_MAX``
     - ``PMA_QUERYHISTORYMAX``
     - how many history entries to keep
   * - ``BMA_UPLOAD_DIR``
     - ``PMA_UPLOADDIR``
     - server-side directory to import files from
   * - ``BMA_SAVE_DIR``
     - ``PMA_SAVEDIR``
     - server-side directory to save exports to
   * - ``BMA_SSL``
     - ``PMA_SSL``
     - ``1``: TLS to the MySQL server
   * - ``BMA_SSL_VERIFY``
     - ``PMA_SSL_VERIFY``
     - verify the server's certificate
   * - ``BMA_SSL_CA``
     - ``PMA_SSL_CA``
     - CA certificate file
   * - ``BMA_SSL_KEY``
     - ``PMA_SSL_KEY``
     - client key file
   * - ``BMA_SSL_CERT``
     - ``PMA_SSL_CERT``
     - client certificate file
   * - ``BMA_SSLS``
     - ``PMA_SSLS``
     - the same per server of BMA_HOSTS, comma-separated
   * - ``BMA_SSL_VERIFIES``
     - ``PMA_SSL_VERIFIES``
     - ″
   * - ``BMA_SSL_CAS``
     - ``PMA_SSL_CAS``
     - ″
   * - ``BMA_SSL_KEYS``
     - ``PMA_SSL_KEYS``
     - ″
   * - ``BMA_SSL_CERTS``
     - ``PMA_SSL_CERTS``
     - ″
   * - ``BMA_SSL_CA_BASE64``
     - ``PMA_SSL_CA_BASE64``
     - the CA certificate itself, base64 (written to BMA_SSL_DIR)
   * - ``BMA_SSL_KEY_BASE64``
     - ``PMA_SSL_KEY_BASE64``
     - the client key itself, base64
   * - ``BMA_SSL_CERT_BASE64``
     - ``PMA_SSL_CERT_BASE64``
     - the client certificate itself, base64
   * - ``BMA_SSL_CAS_BASE64``
     - ``PMA_SSL_CAS_BASE64``
     - ″ per server
   * - ``BMA_SSL_KEYS_BASE64``
     - ``PMA_SSL_KEYS_BASE64``
     - ″ per server
   * - ``BMA_SSL_CERTS_BASE64``
     - ``PMA_SSL_CERTS_BASE64``
     - ″ per server
   * - ``BMA_SSL_DIR``
     - ``PMA_SSL_DIR``
     - where the ``*_BASE64`` files are written
   * - ``BMA_UPLOAD_LIMIT``
     - ``UPLOAD_LIMIT``
     - the largest upload, e.g. ``64M`` (MaxUploadSize; default 512M)
   * - ``BMA_EXEC_TIME_LIMIT``
     - ``MAX_EXECUTION_TIME``
     - seconds an import or export may run (ExecTimeLimit)
   * - ``BMA_MEMORY_LIMIT``
     - ``MEMORY_LIMIT``
     - MemoryLimit (no effect: imports and exports stream)
   * - ``BMA_LISTEN_PORT``
     - ``APACHE_PORT``
     - the port BetterMyAdmin listens on in the container (default 80)
   * - ``BMA_USER_FILE``, ``BMA_PASSWORD_FILE``, ``BMA_HOST_FILE``, ``BMA_HOSTS_FILE``, ``BMA_CONTROL_HOST_FILE``, ``BMA_CONTROL_USER_FILE``, ``BMA_CONTROL_PASSWORD_FILE``
     - ``PMA_USER_FILE``, ``PMA_PASSWORD_FILE``, …
     - the same values read from files (Docker secrets)

``PMA_CONFIG_BASE64``, ``PMA_USER_CONFIG_BASE64`` and ``/etc/phpmyadmin/conf.d``
hold PHP code and are not read; use a configuration file instead (below).

.. _docker-custom:

Customizing configuration file using Docker
-------------------------------------------

Mount a configuration file into ``/etc/bettermyadmin``:

.. code-block:: sh

    docker run -d -p 8080:80 -v ./bettermyadmin.config.json:/etc/bettermyadmin/bettermyadmin.config.json:ro \
        -v bma-data:/var/lib/bettermyadmin ghcr.io/cb-sigma/better-myadmin:latest

.. _checkout:

Installing from a checkout
++++++++++++++++++++++++++

BetterMyAdmin needs Node.js 22.5 or later and pnpm:

.. code-block:: sh

    git clone https://github.com/cB-Sigma/better-myadmin.git
    cd better-myadmin
    pnpm install --frozen-lockfile
    pnpm build          # the web application (apps/web/dist)
    pnpm start          # http://127.0.0.1:8080

``pnpm start`` runs ``node apps/server/bin/bettermyadmin.mjs``, which takes
``--config <file>``, ``--host``, ``--port`` and ``--static <dir>``.

.. _quick_install:

Quick Install
+++++++++++++

#. Start BetterMyAdmin with Docker (:ref:`docker`) or from a checkout
   (:ref:`checkout`).
#. Configure it. Settings come from four layers, each overriding the one
   before:

   #. the defaults: every directive of :ref:`config` with its default value;
   #. the Docker variables above;
   #. a configuration file: ``--config <file>``, the ``BMA_CONFIG`` variable, or
      the first of :file:`bettermyadmin.config.ts`, ``.js``, ``.mjs``, ``.json``,
      ``.yaml``, ``.yml`` in the working directory (``/etc/bettermyadmin`` in the
      image);
   #. ``BMA__<Directive>[__<Sub>…]`` environment variables
      (``BMA__Servers__1__host=db``, ``BMA__MaxRows=50``), plus the shortcuts
      ``BMA_HOST``, ``BMA_PORT``, ``BMA_USER``, ``BMA_PASSWORD``,
      ``BMA_ARBITRARY_SERVER`` and ``BMA_ABSOLUTE_URI``.

#. Log in with a MySQL account.

Manually creating the file
--------------------------

The configuration file holds every directive of :ref:`config` as data:
``$cfg['X']`` in this documentation is the key ``X`` of the file, and
``$cfg['Servers'][$i]`` is an entry of its ``Servers`` list (server 1 first).
If the default value is okay for a particular setting, there is no need to
include it. A simple configuration may look like this:

.. code-block:: json

    {
      "blowfish_secret": "a 32-byte or longer random string",
      "Servers": [
        { "host": "db.example.org", "auth_type": "cookie" }
      ]
    }

Or, if you prefer to not be prompted every time you log in:

.. code-block:: json

    {
      "Servers": [
        { "host": "db.example.org", "auth_type": "config", "user": "root", "password": "changeme" }
      ]
    }

.. warning::

    Storing passwords in the configuration is insecure as anybody can then
    manipulate your database.

A TypeScript file gives type checking and completion over every directive:

.. code-block:: ts

    // bettermyadmin.config.ts
    import { defineConfig } from '@bettermyadmin/config'

    export default defineConfig({
      Servers: [{ host: 'db.example.org', auth_type: 'cookie' }],
      MaxRows: 50,
    })

An unknown directive or an invalid value stops the server with a message
naming the closest directive. Without a ``blowfish_secret``, one is generated
into :config:option:`$cfg['DataDir']` on the first start. The directives of a
phpMyAdmin :file:`config.inc.php` keep their names, so it translates key for
key, and BetterMyAdmin converts one for you:

.. code-block:: sh

    bettermyadmin import-pma-config /etc/phpmyadmin/config.inc.php -o bettermyadmin.config.json

(``node apps/server/bin/bettermyadmin.mjs import-pma-config …`` from a checkout,
``docker run --rm -v /etc/phpmyadmin:/pma:ro ghcr.io/cb-sigma/better-myadmin
node /app/apps/server/bin/bettermyadmin.mjs import-pma-config /pma/config.inc.php``
with Docker). The file is read, not run: the importer evaluates the subset of
PHP that configuration files use (``getenv()`` reads the environment), and the
result is checked like a configuration file before it is written. Without
``-o`` the JSON goes to standard output; an existing file is only replaced with
``--force``. The setup script (below) also shows the configuration it builds in
both formats.

For a full explanation of possible configuration values, see the
:ref:`config` of this document.

.. index:: Setup script

.. _setup_script:

Using the Setup script
----------------------

Until a configuration file exists, the setup script at ``/setup`` is open
without a login, and the server prints a warning when it starts. It lets you
build a configuration page by page and saves it as
:file:`bettermyadmin.config.json` (or shows it for you to copy). Write a
configuration file before exposing the server.

.. _linked-tables:

phpMyAdmin configuration storage
++++++++++++++++++++++++++++++++

.. versionchanged:: 3.4.0

   Prior to phpMyAdmin 3.4.0 this was called Linked Tables Infrastructure, but
   the name was changed due to the extended scope of the storage.

For a whole set of additional features (:ref:`bookmarks`, comments, :term:`SQL`-history,
tracking mechanism, :term:`PDF`-generation, :ref:`transformations`, :ref:`relations`
etc.) you need to create a set of special tables. Those tables can be located
in your own database, or in a central database for a multi-user installation
(this database would then be accessed by the controluser, so no other user
should have rights to it).

BetterMyAdmin uses phpMyAdmin's configuration storage as it is: the same
database (``phpmyadmin`` by default, see
:config:option:`$cfg['Servers'][$i]['pmadb']`), the same ``pma__*`` tables
and the same contents. BetterMyAdmin and phpMyAdmin can therefore share one
configuration storage, and you can switch from one to the other without
losing bookmarks, relations, user preferences or two-factor settings.

Without a configuration storage, BetterMyAdmin keeps the per-user data
(bookmarks, SQL history, recent and favorite tables, table display
preferences and user preferences) in a local SQLite file in
:config:option:`$cfg['DataDir']`; phpMyAdmin offers these only with the
storage, or keeps them until you log out. The features that describe the
databases themselves (relations, comments, transformations, tracking, …)
still need the configuration storage, as they must be shared by all users.

.. _zeroconf:

Zero configuration
------------------

In many cases, this database structure can be automatically created and
configured. This is called “Zero Configuration” mode and can be particularly
useful in shared hosting situations. “ZeroConf” mode is on by default, to
disable set :config:option:`$cfg['ZeroConf']` to false.

The following three scenarios are covered by the Zero Configuration mode:

* When entering a database where the configuration storage tables are not
  present, BetterMyAdmin offers to create them from the Operations tab.
* When entering a database where the tables do already exist, the software
  automatically detects this and begins using them. This is the most common
  situation; after the tables are initially created automatically they are
  continually used without disturbing the user; this is also most useful on
  shared hosting where the user is not able to edit the configuration file and
  usually the user only has access to one database.
* When having access to multiple databases, if the user first enters the
  database containing the configuration storage tables then switches to
  another database,
  BetterMyAdmin continues to use the tables from the first database; the user is
  not prompted to create more tables in the new database.

Manual configuration
--------------------

The tables are created by the SQL script
:file:`packages/metadata/resources/create_tables.sql` of the BetterMyAdmin
repository, which is phpMyAdmin's :file:`resources/sql/create_tables.sql`.
(If your database server runs on Windows, pay special attention to
:ref:`faq1_23`.)

If you already had this infrastructure and upgraded to phpMyAdmin 4.3.0 or
newer from 2.5.0 or newer (<= 4.2.x), please use
:file:`packages/metadata/resources/upgrade_column_info_4_3_0+.sql` (phpMyAdmin's
:file:`resources/sql/upgrade_column_info_4_3_0+.sql`); for older upgrades, use
the scripts shipped with phpMyAdmin.

You can use BetterMyAdmin to create the tables for you: import
:file:`create_tables.sql` from the :guilabel:`Import` tab, or use the links of
the configuration storage check page (linked from the home page and the
Operations tab). Please be aware that you may need special (administrator)
privileges to create the database and tables, and that the script may need
some tuning, depending on the database name.

After having created the tables, you should specify the table names in your
configuration file. The directives used for that can be found in the
:ref:`config` (see also the basic example in :ref:`config-examples`).

You will also need to have a controluser
(:config:option:`$cfg['Servers'][$i]['controluser']` and
:config:option:`$cfg['Servers'][$i]['controlpass']` settings, or the Docker
variables ``PMA_CONTROLUSER`` and ``PMA_CONTROLPASS``)
with the proper rights to those tables. For example you can create it
using following statement:

And for any MariaDB version:

.. code-block:: mysql

   CREATE USER 'pma'@'localhost' IDENTIFIED VIA mysql_native_password USING 'pmapass';
   GRANT SELECT, INSERT, UPDATE, DELETE ON `<pma_db>`.* TO 'pma'@'localhost';

For MySQL 8.0 and newer:

.. code-block:: mysql

   CREATE USER 'pma'@'localhost' IDENTIFIED WITH caching_sha2_password BY 'pmapass';
   GRANT SELECT, INSERT, UPDATE, DELETE ON <pma_db>.* TO 'pma'@'localhost';

For MySQL older than 8.0:

.. code-block:: mysql

   CREATE USER 'pma'@'localhost' IDENTIFIED WITH mysql_native_password AS 'pmapass';
   GRANT SELECT, INSERT, UPDATE, DELETE ON <pma_db>.* TO 'pma'@'localhost';

The host in these statements is the host BetterMyAdmin connects from, as the
MySQL server sees it: with Docker, that is usually the container's address
rather than ``localhost``. BetterMyAdmin's MySQL driver supports
``caching_sha2_password``, so the ``mysql_native_password`` workaround that
phpMyAdmin needs with old PHP versions is not necessary (see :ref:`faq1_45`).

.. _upgrading:

Upgrading from an older version
+++++++++++++++++++++++++++++++

Your configuration file, the Docker variables and the :ref:`linked-tables`
carry over from one version to the next. A directive that a new version no
longer knows stops the server with a message naming it, rather than being
silently ignored; one that phpMyAdmin removed only gives a warning at start.

With Docker, pull the new image and recreate the container, keeping the data
volume (``/var/lib/bettermyadmin``) and your configuration file:

.. code-block:: sh

    docker pull ghcr.io/cb-sigma/better-myadmin:X.Y.Z
    docker rm -f bettermyadmin
    docker run -d --name bettermyadmin -p 8080:80 -e PMA_HOST=mysql.example.org \
        -v bma-data:/var/lib/bettermyadmin ghcr.io/cb-sigma/better-myadmin:X.Y.Z

or, with Docker Compose, change the image tag and run
``docker compose pull && docker compose up -d``.

From a checkout, update the sources, the dependencies and the web
application, then restart the server:

.. code-block:: sh

    git pull
    pnpm install --frozen-lockfile
    pnpm build
    pnpm start

The release notes of each version are in the `changelog
<https://github.com/cB-Sigma/better-myadmin/blob/main/CHANGELOG.md>`_.

If you have upgraded your phpMyAdmin to 4.3.0 or newer from 2.5.0 or
newer (<= 4.2.x) and if you use the phpMyAdmin configuration storage, you
should run the :term:`SQL` script found in
:file:`packages/metadata/resources/upgrade_column_info_4_3_0+.sql`.

Do not forget to clear the browser cache and to empty the old session by
logging out and logging in again.

.. index:: Authentication mode

.. _authentication_modes:

Using authentication modes
++++++++++++++++++++++++++

:term:`HTTP` and cookie authentication modes are recommended in a **multi-user
environment** where you want to give users access to their own database and
don't want them to play around with others. Even in a **single-user
environment**, you might prefer to use :term:`HTTP` or cookie mode so that
your user/password pair are not in clear in the configuration file.

:term:`HTTP` and cookie authentication
modes are more secure: the MySQL login information does not need to be
set in the BetterMyAdmin configuration file (except possibly for the
:config:option:`$cfg['Servers'][$i]['controluser']`).
However, keep in mind that the password travels in plain text unless
you are using the HTTPS protocol. In every mode, BetterMyAdmin keeps the
credentials encrypted (AES-256-GCM) in its server-side session store; the
browser only gets a cookie with the session id. (phpMyAdmin stores the
encrypted password in the cookie itself.)

Then each of the *true* users should be granted a set of privileges
on a set of particular databases. Normally you shouldn't give global
privileges to an ordinary user unless you understand the impact of those
privileges (for example, you are creating a superuser).
For example, to grant the user *real_user* with all privileges on
the database *user_base*:

.. code-block:: mysql

   GRANT ALL PRIVILEGES ON user_base.* TO 'real_user'@localhost IDENTIFIED BY 'real_password';

What the user may now do is controlled entirely by the MySQL user management
system. With HTTP or cookie authentication mode, you don't need to fill the
user/password fields inside the :config:option:`$cfg['Servers']`.

.. seealso::

    :ref:`faq1_32`,
    :ref:`faq1_35`,
    :ref:`faq4_1`,
    :ref:`faq4_2`,
    :ref:`faq4_3`

.. index:: pair: HTTP; Authentication mode

.. _auth_http:

HTTP authentication mode
------------------------

* Uses :term:`HTTP` Basic authentication
  method and allows you to log in as any valid MySQL user.
* BetterMyAdmin reads the credentials when a page loads and then keeps them
  in the session, like cookie mode; the realm shown by the browser is
  :config:option:`$cfg['Servers'][$i]['auth_http_realm']` (by default
  "BetterMyAdmin" and the server's name).
* If a reverse proxy is in front of BetterMyAdmin, it must pass the
  ``Authorization`` header through (most do by default).
* See also :ref:`faq4_4` about not using the :term:`.htaccess` mechanism along with
  ':term:`HTTP`' authentication mode.

.. note::

    There is no way to do proper logout in HTTP authentication, most browsers
    will remember credentials until there is no different successful
    authentication. Because of this, this method has a limitation that you can not
    login with the same user after logout.

.. index:: pair: Cookie; Authentication mode

.. _cookie:

Cookie authentication mode
--------------------------

* The user logs in with a form; the credentials are kept, encrypted, in the
  server-side session, and the browser gets a cookie holding only the session
  id. They are deleted when the session ends.
* With this mode, the user can truly log out of BetterMyAdmin and log
  back in with the same username (this is not possible with :ref:`auth_http`).
* If you want to allow users to enter any hostname to connect (rather than only
  servers that are configured in the configuration file),
  see the :config:option:`$cfg['AllowArbitraryServer']` directive.
* Failed logins are rate limited by default, see
  :config:option:`$cfg['LoginRateLimit']`.

.. index:: pair: Signon; Authentication mode

.. _auth_signon:

Signon authentication mode
--------------------------

* This mode is a convenient way of using credentials from another
  application to authenticate to BetterMyAdmin to implement a single signon
  solution.
* The other application hands the login information over in a cookie (see
  :config:option:`$cfg['Servers'][$i]['SignonSession']` and
  :config:option:`$cfg['Servers'][$i]['SignonCookieParams']`), or you
  implement a module to return the credentials (see
  :config:option:`$cfg['Servers'][$i]['SignonScript']`).
* When no credentials are available, the user is being redirected to
  :config:option:`$cfg['Servers'][$i]['SignonURL']`, where you should handle
  the login process.

phpMyAdmin reads the credentials from the other application's PHP session and
runs PHP signon scripts. BetterMyAdmin cannot run PHP, so its signon mode
works with the same keys (``PMA_single_signon_user``,
``PMA_single_signon_password``, ``PMA_single_signon_host``, …) in a different
container:

* the ``SignonSession`` is a cookie of that name whose value is encrypted with
  a key derived from :config:option:`$cfg['blowfish_secret']` (the other
  application uses ``encodeSignonSession`` from BetterMyAdmin's sources, or
  runs on the same host as BetterMyAdmin and shares the cookie);
* the login page can be served by BetterMyAdmin itself, from a JavaScript
  module named by :config:option:`$cfg['Servers'][$i]['SignonPage']` (in
  phpMyAdmin it is a PHP page run by the same web server);
* :config:option:`$cfg['Servers'][$i]['SignonScript']` names a JavaScript or
  TypeScript module exporting ``getLoginCredentials(user)`` instead of a PHP
  file.

The simplest setup is a login page served by BetterMyAdmin,
:file:`apps/server/examples/signon-page.mjs`, which stores the credentials
typed into a form (the counterpart of phpMyAdmin's
:file:`examples/signon.php`):

.. literalinclude:: ../apps/server/examples/signon-page.mjs
    :language: js

A separate login application writes the cookie itself, as in
:file:`apps/server/examples/signon.ts` (run with
``BMA_SECRET=<blowfish_secret> npx tsx apps/server/examples/signon.ts``):

.. literalinclude:: ../apps/server/examples/signon.ts
    :language: ts

phpMyAdmin's OpenID example (:file:`examples/openid.php`) has no
BetterMyAdmin counterpart; an OpenID or other single signon front end can use
either of the ways above.

If you intend to pass the credentials using some other means than the
cookie, you have to implement a module to get that data and set it to
:config:option:`$cfg['Servers'][$i]['SignonScript']`. There is a very minimal example
in :file:`apps/server/examples/signon-script.ts`:

.. literalinclude:: ../apps/server/examples/signon-script.ts
    :language: ts

.. seealso::
    :config:option:`$cfg['Servers'][$i]['auth_type']`,
    :config:option:`$cfg['Servers'][$i]['SignonSession']`,
    :config:option:`$cfg['Servers'][$i]['SignonCookieParams']`,
    :config:option:`$cfg['Servers'][$i]['SignonScript']`,
    :config:option:`$cfg['Servers'][$i]['SignonURL']`,
    :config:option:`$cfg['Servers'][$i]['SignonPage']`,
    :ref:`example-signon`

.. index:: pair: Config; Authentication mode

.. _auth_config:

Config authentication mode
--------------------------

* This mode is sometimes the less secure one because it requires you to fill the
  :config:option:`$cfg['Servers'][$i]['user']` and
  :config:option:`$cfg['Servers'][$i]['password']`
  fields (or the Docker variables ``PMA_USER`` and ``PMA_PASSWORD``), and as a
  result, anyone who can read your configuration file or environment can
  discover your username and password.
* In the :ref:`faqmultiuser` section, there is an entry explaining how
  to protect your configuration file.
* For additional security in this mode, you may wish to consider the
  Host authentication :config:option:`$cfg['Servers'][$i]['AllowDeny']['order']`
  and :config:option:`$cfg['Servers'][$i]['AllowDeny']['rules']` configuration directives.
* Unlike cookie and http, does not require a user to log in when first
  loading the BetterMyAdmin site. This is by design but could allow any
  user to access your installation. Use of some restriction method is
  suggested: keep BetterMyAdmin listening on ``127.0.0.1`` (the default of
  :config:option:`$cfg['Listen']['host']`), put an authenticating reverse
  proxy in front of it, or disallow incoming HTTP requests at one’s router or
  firewall.

.. _securing:

Securing your BetterMyAdmin installation
++++++++++++++++++++++++++++++++++++++++

The BetterMyAdmin project tries hard to make the application secure, however
there are always ways to make your installation more secure. See also
:ref:`security`.

* Follow the `BetterMyAdmin releases
  <https://github.com/cB-Sigma/better-myadmin/releases>`_ and upgrade
  whenever a new vulnerability is published (see :ref:`upgrading`).
* Write a configuration file before exposing BetterMyAdmin: until one exists,
  the :ref:`setup_script` is open without a login (the Docker image ships an
  empty one, so it is closed there).
* Serve BetterMyAdmin on HTTPS only, for example behind a reverse proxy that
  terminates TLS. Preferably, you should use HSTS as well, so that you're
  protected from protocol downgrade attacks: :config:option:`$cfg['ForceSSL']`
  redirects plain HTTP to HTTPS and sends the HSTS header.
* Expose only what is needed: BetterMyAdmin listens on ``127.0.0.1`` by
  default (:config:option:`$cfg['Listen']['host']`); let only the reverse
  proxy reach it.
* Properly choose an authentication method - :ref:`cookie`
  is probably the best choice for shared hosting.
* Keep :config:option:`$cfg['DataDir']` private: it holds the sessions and
  the generated :config:option:`$cfg['blowfish_secret']`. BetterMyAdmin
  creates it with mode ``0700`` and runs as the unprivileged ``node`` user in
  the Docker image. Treat :config:option:`$cfg['UploadDir']` and
  :config:option:`$cfg['SaveDir']` the same way (see :ref:`web-dirs`).
* It is generally a good idea to protect a public BetterMyAdmin installation
  against access by robots as they usually can not do anything good there.
  BetterMyAdmin sends an ``X-Robots-Tag: noindex, nofollow`` header on every
  response; see also :ref:`faq1_42`.
* In case you don't want all MySQL users to be able to access
  BetterMyAdmin, you can use :config:option:`$cfg['Servers'][$i]['AllowDeny']['rules']` to limit them
  or :config:option:`$cfg['Servers'][$i]['AllowRoot']` to deny root user access.
* Enable :ref:`2fa` for your account.
* Consider hiding BetterMyAdmin behind an authentication proxy, so that
  users need to authenticate prior to providing MySQL credentials
  to BetterMyAdmin. You can achieve this by configuring your reverse proxy to
  request HTTP authentication, or with a single signon front end
  (:ref:`auth_signon`).
* Failed logins are rate limited by default
  (:config:option:`$cfg['LoginRateLimit']`). If you are afraid of automated
  attacks, enabling Captcha by
  :config:option:`$cfg['CaptchaLoginPublicKey']` and
  :config:option:`$cfg['CaptchaLoginPrivateKey']` might be an option too.
* Failed login attempts are logged (see :config:option:`$cfg['AuthLog']`): to
  the server's error output by default, or to a file. A file log can be used
  by a tool such as fail2ban to block brute-force attempts. BetterMyAdmin has
  no syslog support.

.. _ssl:

Using SSL for connection to database server
+++++++++++++++++++++++++++++++++++++++++++

It is recommended to use SSL when connecting to remote database server. There
are several configuration options involved in the SSL setup:

:config:option:`$cfg['Servers'][$i]['ssl']`
    Defines whether to use SSL at all. If you enable only this, the connection
    will be encrypted, but there is not authentication of the connection - you
    can not verify that you are talking to the right server.
:config:option:`$cfg['Servers'][$i]['ssl_key']` and :config:option:`$cfg['Servers'][$i]['ssl_cert']`
    This is used for authentication of client to the server.
:config:option:`$cfg['Servers'][$i]['ssl_ca']` and :config:option:`$cfg['Servers'][$i]['ssl_ca_path']`
    The certificate authorities you trust for server certificates.
    This is used to ensure that you are talking to a trusted server.
:config:option:`$cfg['Servers'][$i]['ssl_verify']`
    This configuration disables server certificate verification. Use with
    caution.

With Docker, the ``PMA_SSL``, ``PMA_SSL_VERIFY``, ``PMA_SSL_CA``,
``PMA_SSL_KEY`` and ``PMA_SSL_CERT`` variables set these (see
:ref:`docker-vars`).

When the database server is using a local connection or private network and SSL can not be configured
you can use :config:option:`$cfg['MysqlSslWarningSafeHosts']` to explicitly list the hostnames that are considered secure.

.. seealso::

    :ref:`example-google-ssl`,
    :ref:`example-aws-ssl`,
    :config:option:`$cfg['Servers'][$i]['ssl']`,
    :config:option:`$cfg['Servers'][$i]['ssl_key']`,
    :config:option:`$cfg['Servers'][$i]['ssl_cert']`,
    :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
    :config:option:`$cfg['Servers'][$i]['ssl_ca_path']`,
    :config:option:`$cfg['Servers'][$i]['ssl_ciphers']`,
    :config:option:`$cfg['Servers'][$i]['ssl_verify']`

Known issues
++++++++++++

Users with column-specific privileges are unable to "Browse"
------------------------------------------------------------

If a user has only column-specific privileges on some (but not all) columns in a table, "Browse"
will fail with an error message, as in phpMyAdmin.

As a workaround, a bookmarked query with the same name as the table can be created, this will
run when using the "Browse" link instead. `phpMyAdmin issue 11922 <https://github.com/phpmyadmin/phpmyadmin/issues/11922>`_.

Trouble logging back in after logging out using 'http' authentication
----------------------------------------------------------------------

When using the 'http' ``auth_type``, the browser keeps sending the same
credentials after a logout, so BetterMyAdmin refuses that user once to end
the session; logging back in with the same user may need the browser to
forget the credentials first. `phpMyAdmin issue 11898 <https://github.com/phpmyadmin/phpmyadmin/issues/11898>`_.
