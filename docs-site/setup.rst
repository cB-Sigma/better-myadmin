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

then open ``http://localhost:8080``. Pin a version (``:1.0.9``) instead of
``:latest`` in production.

The image takes the variables of phpMyAdmin's official Docker image, so a
compose file written for the ``phpmyadmin`` image works with the image name
swapped. It keeps its sessions, the generated ``blowfish_secret`` and its local
metadata in the ``/var/lib/bettermyadmin`` volume, runs as the unprivileged
``node`` user and listens on port 80 inside the container (``APACHE_PORT``
changes it).

.. _docker-vars:

Docker environment variables
----------------------------

``PMA_HOST``, ``PMA_PORT``, ``PMA_VERBOSE``
    The server to log in to (default: the linked ``db``).

``PMA_HOSTS``, ``PMA_PORTS``, ``PMA_VERBOSES``
    Several servers, comma-separated.

``PMA_SOCKET``, ``PMA_SOCKETS``
    Servers reached through a socket.

``PMA_ARBITRARY``
    Set to ``1`` to let the login form name any server.

``PMA_USER``, ``PMA_PASSWORD``
    Config authentication: no login form.

``PMA_ABSOLUTE_URI``
    The public URL when BetterMyAdmin is behind a reverse proxy.

``PMA_PMADB``, ``PMA_CONTROLHOST``, ``PMA_CONTROLPORT``, ``PMA_CONTROLUSER``, ``PMA_CONTROLPASS``
    The :ref:`linked-tables` and its control user.

``PMA_QUERYHISTORYDB``, ``PMA_QUERYHISTORYMAX``
    The SQL history in the configuration storage.

``PMA_UPLOADDIR``, ``PMA_SAVEDIR``
    Server-side import and export directories.

``PMA_SSL``, ``PMA_SSL_VERIFY``, ``PMA_SSL_CA``, ``PMA_SSL_KEY``, ``PMA_SSL_CERT``
    TLS to the MySQL server (also the plural lists and the ``*_BASE64`` forms).

``UPLOAD_LIMIT``
    The largest upload, for example ``64M`` (:config:option:`MaxUploadSize`).

``MAX_EXECUTION_TIME``
    :config:option:`$cfg['ExecTimeLimit']`.

``APACHE_PORT``
    The port inside the container (default 80).

``PMA_USER_FILE``, ``PMA_PASSWORD_FILE``, ``PMA_HOST_FILE``, …
    The same values read from Docker secrets.

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
into :config:option:`DataDir` on the first start. A phpMyAdmin
:file:`config.inc.php` can be converted with ``bma import-pma-config``.

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

.. _zeroconf:

Zero configuration
------------------

In many cases, this database structure can be automatically created and
configured. This is called “Zero Configuration” mode and can be particularly
useful in shared hosting situations. “ZeroConf” mode is on by default, to
disable set :config:option:`$cfg['ZeroConf']` to false.

The following three scenarios are covered by the Zero Configuration mode:

* When entering a database where the configuration storage tables are not
  present, phpMyAdmin offers to create them from the Operations tab.
* When entering a database where the tables do already exist, the software
  automatically detects this and begins using them. This is the most common
  situation; after the tables are initially created automatically they are
  continually used without disturbing the user; this is also most useful on
  shared hosting where the user is not able to edit :file:`config.inc.php` and
  usually the user only has access to one database.
* When having access to multiple databases, if the user first enters the
  database containing the configuration storage tables then switches to
  another database,
  phpMyAdmin continues to use the tables from the first database; the user is
  not prompted to create more tables in the new database.

Manual configuration
--------------------

Please look at your ``./resources/sql/`` directory, where you should find a
file called *create\_tables.sql*. (If you are using a Windows server,
pay special attention to :ref:`faq1_23`).

If you already had this infrastructure and:

* upgraded to MySQL 4.1.2 or newer, please use
  :file:`resources/sql/upgrade_tables_mysql_4_1_2+.sql`.
* upgraded to phpMyAdmin 4.3.0 or newer from 2.5.0 or newer (<= 4.2.x),
  please use :file:`resources/sql/upgrade_column_info_4_3_0+.sql`.
* upgraded to phpMyAdmin 4.7.0 or newer from 4.3.0 or newer,
  please use :file:`resources/sql/upgrade_tables_4_7_0+.sql`.

and then create new tables by importing :file:`resources/sql/create_tables.sql`.

You can use your phpMyAdmin to create the tables for you. Please be
aware that you may need special (administrator) privileges to create
the database and tables, and that the script may need some tuning,
depending on the database name.

After having imported the :file:`resources/sql/create_tables.sql` file, you
should specify the table names in your :file:`config.inc.php` file. The
directives used for that can be found in the :ref:`config`.

You will also need to have a controluser
(:config:option:`$cfg['Servers'][$i]['controluser']` and
:config:option:`$cfg['Servers'][$i]['controlpass']` settings)
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

Note that MySQL installations with PHP older than 7.4 and MySQL newer than 8.0 may require
using the mysql_native_password authentication as a workaround, see
:ref:`faq1_45` for details.

.. _upgrading:

Upgrading from an older version
+++++++++++++++++++++++++++++++

.. warning::

    **Never** extract the new version over an existing installation of
    phpMyAdmin, always first remove the old files keeping just the
    configuration.

    This way, you will not leave any old or outdated files in the directory,
    which can have severe security implications or can cause various breakages.

Simply copy :file:`config.inc.php` from your previous installation into
the newly unpacked one. Configuration files from old versions may
require some tweaking as some options have been changed or removed.
For compatibility with PHP 5.3 and later, remove a
``set_magic_quotes_runtime(0);`` statement that you might find near
the end of your configuration file.

The complete upgrade can be performed in a few simple steps:

1. Download the latest phpMyAdmin version from <https://www.phpmyadmin.net/downloads/>.
2. Rename existing phpMyAdmin folder (for example to ``phpmyadmin-old``).
3. Unpack freshly downloaded phpMyAdmin to the desired location (for example ``phpmyadmin``).
4. Copy :file:`config.inc.php`` from old location (``phpmyadmin-old``) to the new one (``phpmyadmin``).
5. Test that everything works properly.
6. Remove backup of a previous version (``phpmyadmin-old``).

If you have upgraded your MySQL server from a version previous to 4.1.2 to
version 5.x or newer and if you use the phpMyAdmin configuration storage, you
should run the :term:`SQL` script found in
:file:`resources/sql/upgrade_tables_mysql_4_1_2+.sql`.

If you have upgraded your phpMyAdmin to 4.3.0 or newer from 2.5.0 or
newer (<= 4.2.x) and if you use the phpMyAdmin configuration storage, you
should run the :term:`SQL` script found in
:file:`resources/sql/upgrade_column_info_4_3_0+.sql`.

Do not forget to clear the browser cache and to empty the old session by
logging out and logging in again.

.. index:: Authentication mode

.. _authentication_modes:

Using authentication modes
++++++++++++++++++++++++++

:term:`HTTP` and cookie authentication modes are recommended in a **multi-user
environment** where you want to give users access to their own database and
don't want them to play around with others. Nevertheless, be aware that MS
Internet Explorer seems to be really buggy about cookies, at least till version
6. Even in a **single-user environment**, you might prefer to use :term:`HTTP`
or cookie mode so that your user/password pair are not in clear in the
configuration file.

:term:`HTTP` and cookie authentication
modes are more secure: the MySQL login information does not need to be
set in the phpMyAdmin configuration file (except possibly for the
:config:option:`$cfg['Servers'][$i]['controluser']`).
However, keep in mind that the password travels in plain text unless
you are using the HTTPS protocol. In cookie mode, the password is
stored, encrypted with the AES algorithm, in a temporary cookie.

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
* Is supported with most PHP configurations. For :term:`IIS` (:term:`ISAPI`)
  support using :term:`CGI` PHP see :ref:`faq1_32`, for using with Apache
  :term:`CGI` see :ref:`faq1_35`.
* When PHP is running under Apache's :term:`mod_proxy_fcgi` (e.g. with PHP-FPM),
  ``Authorization`` headers are not passed to the underlying FCGI application,
  such that your credentials will not reach the application. In this case, you can
  add the following configuration directive:

  .. code-block:: apache

     SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1

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

* Username and password are stored in cookies during the session and password
  is deleted when it ends.
* With this mode, the user can truly log out of phpMyAdmin and log
  back in with the same username (this is not possible with :ref:`auth_http`).
* If you want to allow users to enter any hostname to connect (rather than only
  servers that are configured in :file:`config.inc.php`),
  see the :config:option:`$cfg['AllowArbitraryServer']` directive.
* As mentioned in the :ref:`require` section, having the ``openssl`` extension
  will speed up access considerably, but is not required.

.. index:: pair: Signon; Authentication mode

.. _auth_signon:

Signon authentication mode
--------------------------

* This mode is a convenient way of using credentials from another
  application to authenticate to phpMyAdmin to implement a single signon
  solution.
* The other application has to store login information into session
  data (see :config:option:`$cfg['Servers'][$i]['SignonSession']` and
  :config:option:`$cfg['Servers'][$i]['SignonCookieParams']`) or you
  need to implement script to return the credentials (see
  :config:option:`$cfg['Servers'][$i]['SignonScript']`).
* When no credentials are available, the user is being redirected to
  :config:option:`$cfg['Servers'][$i]['SignonURL']`, where you should handle
  the login process.

The very basic example of saving credentials in a session is available as
:file:`examples/signon.php`:

.. literalinclude:: ../examples/signon.php
    :language: php

Alternatively, you can also use this way to integrate with OpenID as shown
in :file:`examples/openid.php`:

.. literalinclude:: ../examples/openid.php
    :language: php

If you intend to pass the credentials using some other means than, you have to
implement wrapper in PHP to get that data and set it to
:config:option:`$cfg['Servers'][$i]['SignonScript']`. There is a very minimal example
in :file:`examples/signon-script.php`:

.. literalinclude:: ../examples/signon-script.php
    :language: php

.. seealso::
    :config:option:`$cfg['Servers'][$i]['auth_type']`,
    :config:option:`$cfg['Servers'][$i]['SignonSession']`,
    :config:option:`$cfg['Servers'][$i]['SignonCookieParams']`,
    :config:option:`$cfg['Servers'][$i]['SignonScript']`,
    :config:option:`$cfg['Servers'][$i]['SignonURL']`,
    :ref:`example-signon`

.. index:: pair: Config; Authentication mode

.. _auth_config:

Config authentication mode
--------------------------

* This mode is sometimes the less secure one because it requires you to fill the
  :config:option:`$cfg['Servers'][$i]['user']` and
  :config:option:`$cfg['Servers'][$i]['password']`
  fields (and as a result, anyone who can read your :file:`config.inc.php`
  can discover your username and password).
* In the :ref:`faqmultiuser` section, there is an entry explaining how
  to protect your configuration file.
* For additional security in this mode, you may wish to consider the
  Host authentication :config:option:`$cfg['Servers'][$i]['AllowDeny']['order']`
  and :config:option:`$cfg['Servers'][$i]['AllowDeny']['rules']` configuration directives.
* Unlike cookie and http, does not require a user to log in when first
  loading the phpMyAdmin site. This is by design but could allow any
  user to access your installation. Use of some restriction method is
  suggested, perhaps a :term:`.htaccess` file with the HTTP-AUTH directive or disallowing
  incoming HTTP requests at one’s router or firewall will suffice (both
  of which are beyond the scope of this manual but easily searchable
  with Google).

.. _securing:

Securing your phpMyAdmin installation
+++++++++++++++++++++++++++++++++++++

The phpMyAdmin team tries hard to make the application secure, however there
are always ways to make your installation more secure:

* Follow our `Security announcements <https://www.phpmyadmin.net/security/>`_ and upgrade
  phpMyAdmin whenever new vulnerability is published.
* Serve phpMyAdmin on HTTPS only. Preferably, you should use HSTS as well, so that
  you're protected from protocol downgrade attacks.
* Ensure your PHP setup follows recommendations for production sites, for example
  `display_errors <https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors>`_
  should be disabled.
* Remove the ``tests`` directory from phpMyAdmin, unless you are developing and need a test suite.
* Remove the ``setup`` directory from phpMyAdmin, you will probably not
  use it after the initial setup.
* Properly choose an authentication method - :ref:`cookie`
  is probably the best choice for shared hosting.
* Deny access to auxiliary files in :file:`./libraries/` or
  :file:`./templates/` subfolders in your webserver configuration.
  Such configuration prevents from possible path exposure and cross side
  scripting vulnerabilities that might happen to be found in that code. For the
  Apache webserver, this is often accomplished with a :term:`.htaccess` file in
  those directories.
* Deny access to temporary files, see :config:option:`$cfg['TempDir']` (if that
  is placed inside your web root, see also :ref:`web-dirs`.
* It is generally a good idea to protect a public phpMyAdmin installation
  against access by robots as they usually can not do anything good there. You
  can do this using ``robots.txt`` file in the root of your webserver or limit
  access by web server configuration, see :ref:`faq1_42`.
* In case you don't want all MySQL users to be able to access
  phpMyAdmin, you can use :config:option:`$cfg['Servers'][$i]['AllowDeny']['rules']` to limit them
  or :config:option:`$cfg['Servers'][$i]['AllowRoot']` to deny root user access.
* Enable :ref:`2fa` for your account.
* Consider hiding phpMyAdmin behind an authentication proxy, so that
  users need to authenticate prior to providing MySQL credentials
  to phpMyAdmin. You can achieve this by configuring your web server to request
  HTTP authentication. For example in Apache this can be done with:

  .. code-block:: apache

     AuthType Basic
     AuthName "Restricted Access"
     AuthUserFile /usr/share/phpmyadmin/passwd
     Require valid-user

  Once you have changed the configuration, you need to create a list of users which
  can authenticate. This can be done using the :program:`htpasswd` utility:

  .. code-block:: sh

     htpasswd -c /usr/share/phpmyadmin/passwd username

* If you are afraid of automated attacks, enabling Captcha by
  :config:option:`$cfg['CaptchaLoginPublicKey']` and
  :config:option:`$cfg['CaptchaLoginPrivateKey']` might be an option.
* Failed login attempts are logged to syslog (if available, see
  :config:option:`$cfg['AuthLog']`). This can allow using a tool such as
  fail2ban to block brute-force attempts. Note that the log file used by syslog
  is not the same as the Apache error or access log files.
* In case you're running phpMyAdmin together with other PHP applications, it is
  generally advised to use separate session storage for phpMyAdmin to avoid
  possible session-based attacks against it. You can use
  :config:option:`$cfg['SessionSavePath']` to achieve this.

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
will fail with an error message.

As a workaround, a bookmarked query with the same name as the table can be created, this will
run when using the "Browse" link instead. `Issue 11922 <https://github.com/phpmyadmin/phpmyadmin/issues/11922>`_.

Trouble logging back in after logging out using 'http' authentication
----------------------------------------------------------------------

When using the 'http' ``auth_type``, it can be impossible to log back in (when the logout comes
manually or after a period of inactivity). `Issue 11898 <https://github.com/phpmyadmin/phpmyadmin/issues/11898>`_.

.. _Composer tool: https://getcomposer.org/
.. _Packagist: https://packagist.org/
.. _Docker official image: https://hub.docker.com/_/phpmyadmin
