.. index:: configuration file, bettermyadmin.config.json

.. _config:

Configuration
=============

BetterMyAdmin accepts every configuration directive of phpMyAdmin under the
same name and with the same default value, plus a few of its own
(:ref:`config-bma`). Settings come from four layers, each overriding the one
before:

#. the defaults listed on this page;
#. the variables of phpMyAdmin's Docker image (:ref:`docker-vars`);
#. a configuration file: ``--config <file>``, the ``BMA_CONFIG`` environment
   variable, or the first of :file:`bettermyadmin.config.ts`, ``.js``,
   ``.mjs``, ``.json``, ``.yaml``, ``.yml`` in the working directory
   (``/etc/bettermyadmin`` in the Docker image);
#. ``BMA__<Directive>[__<Sub>…]`` environment variables
   (``BMA__Servers__1__host=db``, ``BMA__MaxRows=50``,
   ``BMA__Export__format=csv``), plus the shortcuts ``BMA_HOST``, ``BMA_PORT``,
   ``BMA_USER``, ``BMA_PASSWORD``, ``BMA_ARBITRARY_SERVER`` and
   ``BMA_ABSOLUTE_URI``.

If no configuration file exists, please refer to the :ref:`setup` section to
create one. The file only needs to contain the directives you want to change
from their default value; if you wish to use the default value there's no need
to list it. An unknown directive or an invalid value stops the server with a
message naming the closest directive (phpMyAdmin silently uses the default
instead).

.. rubric:: Notation

This page names the directives in phpMyAdmin's notation, which is also what
the setup script and phpMyAdmin's own documentation use. In the configuration
file:

* ``$cfg['X']`` is the key ``X`` of the file;
* ``$cfg['X']['Y']`` is the key ``Y`` of the object ``X``
  (``"Export": { "format": "csv" }``);
* ``$cfg['Servers'][$i]['Y']`` is the key ``Y`` of an entry of the ``Servers``
  list, server 1 first.

For example, this :file:`bettermyadmin.config.json`:

.. code-block:: json

    {
      "blowfish_secret": "a 32-byte or longer random string",
      "Servers": [
        { "host": "db.example.org", "port": 3306, "auth_type": "cookie" },
        { "host": "replica.example.org", "verbose": "Replica" }
      ],
      "MaxRows": 50,
      "Export": { "format": "csv" }
    }

sets :config:option:`$cfg['blowfish_secret']`,
:config:option:`$cfg['Servers'][$i]['host']` of two servers,
:config:option:`$cfg['MaxRows']` and :config:option:`$cfg['Export']['format']`.
The same configuration can be written as YAML, or as a JavaScript or
TypeScript module whose default export is the object (see :ref:`setup`). The
code examples on this page are written as JSON.

Version notes such as "New in version 4.8.0" or "Deprecated since version
4.7.0" refer to phpMyAdmin's versions. A directive that phpMyAdmin removed is
accepted by BetterMyAdmin with a warning at start, and has no effect.

The look of the interface (colors, fonts) comes from the themes, see
:ref:`themes`. phpMyAdmin's :file:`config.header.inc.php` and
:file:`config.footer.inc.php` include files are PHP and are not supported.

.. seealso::

    :ref:`config-examples` for examples of configurations

Basic settings
--------------

.. config:option:: $cfg['PmaAbsoluteUri']

    :type: string
    :default: ``''``

    .. versionchanged:: 4.6.5

        This setting was not available in phpMyAdmin 4.6.0 - 4.6.4.

    Sets here the complete public :term:`URL` (with full path) at which users
    reach BetterMyAdmin. E.g. ``https://www.example.net/bettermyadmin/``.
    Don’t forget the trailing slash at the end. The Docker variable
    ``PMA_ABSOLUTE_URI`` and the environment variable ``BMA_ABSOLUTE_URI`` set
    it too.

    It is advisable to try leaving this blank. In most cases BetterMyAdmin
    automatically detects the proper setting. Users of port forwarding or
    complex reverse proxy setup might need to set this (see also
    :config:option:`$cfg['Listen']['basePath']`).

    A good test is to browse a table, edit a row and save it. If you get an
    error that this must be set or if the autodetect code fails to detect your
    path, please post a bug report on our bug tracker so we can improve the
    code.

    .. seealso:: :ref:`faq1_40`, :ref:`faq2_5`, :ref:`faq4_7`, :ref:`faq5_16`

.. config:option:: $cfg['PmaNoRelation_DisableWarning']

    :type: boolean
    :default: false

    BetterMyAdmin offers a lot of features to
    work with master / foreign – tables (see :config:option:`$cfg['Servers'][$i]['pmadb']`).

    If you tried to set this
    up and it does not work for you, have a look on the :guilabel:`Structure` page
    of one database where you would like to use it. You will find a link
    that will analyze why those features have been disabled.

    If you do not want to use those features set this variable to ``true`` to
    stop this message from appearing.

.. config:option:: $cfg['AuthLog']

    :type: string
    :default: ``'auto'``

    .. versionadded:: 4.8.0

        This is supported since phpMyAdmin 4.8.0.

    Configure authentication logging destination. Failed (or all, depending on
    :config:option:`$cfg['AuthLogSuccess']`) authentication attempts will be
    logged according to this directive:

    ``auto``
        Log to the server's error output (stderr), like ``php`` and ``sapi``.
        (phpMyAdmin logs to syslog when PHP has it; Node.js has no syslog.)
    ``syslog``
        Nothing is logged: BetterMyAdmin has no syslog support.
    ``php``
        Log to the server's error output (stderr).
    ``sapi``
        Log to the server's error output (stderr).
    ``/path/to/file``
        Any other value is treated as a filename and log entries are appended
        there, in phpMyAdmin's format (``M d H:i:s phpmyadmin: …``).

    A successful login is logged once per login (the session then keeps it),
    a failure at each failed login, and ``no-activity`` when a session
    expires.

    .. note::

        When logging to a file, make sure the user running BetterMyAdmin can
        write it.

.. config:option:: $cfg['AuthLogSuccess']

    :type: boolean
    :default: false

    .. versionadded:: 4.8.0

        This is supported since phpMyAdmin 4.8.0.

    Whether to log successful authentication attempts into
    :config:option:`$cfg['AuthLog']`.

.. config:option:: $cfg['SuhosinDisableWarning']

    :type: boolean
    :default: false

    .. deprecated:: 6.0.0

        This setting has been removed. The Suhosin extension is no longer supported.

    A warning is displayed on the main page if Suhosin is detected.

    You can set this parameter to ``true`` to stop this message from appearing.

.. config:option:: $cfg['LoginCookieValidityDisableWarning']

    :type: boolean
    :default: false

    In phpMyAdmin, a warning is displayed on the main page if the PHP parameter
    ``session.gc_maxlifetime`` is lower than cookie validity configured in phpMyAdmin.

    .. note::

        This directive has no effect in BetterMyAdmin: it has no PHP session
        settings (sessions are kept until twice the cookie lifetime has
        passed), so the warning never appears. It is accepted in the
        configuration but no settings form lists it.

.. config:option:: $cfg['ServerLibraryDifference_DisableWarning']

    :type: boolean
    :default: false

    .. deprecated:: 4.7.0

        This setting was removed as the warning has been removed as well.

    A warning is displayed on the main page if there is a difference
    between the MySQL library and server version.

    You can set this parameter to ``true`` to stop this message from appearing.

.. config:option:: $cfg['ReservedWordDisableWarning']

    :type: boolean
    :default: false

    This warning is displayed on the Structure page of a table if one or more
    column names match with words which are MySQL reserved.

    If you want to turn off this warning, you can set it to ``true`` and
    warning will no longer be displayed.

.. config:option:: $cfg['TranslationWarningThreshold']

    :type: integer
    :default: 80

    Show warning about incomplete translations on certain threshold.

.. config:option:: $cfg['SendErrorReports']

    :type: string
    :default: ``'ask'``

    Valid values are:

    * ``ask``
    * ``always``
    * ``never``

    Sets the default behavior for JavaScript error reporting.

    Whenever an error is detected in the JavaScript execution, an error report
    may be sent to the BetterMyAdmin project if the user agrees (phpMyAdmin
    sends its reports to phpmyadmin.net).

    The default setting of ``'ask'`` will ask the user everytime there is a new
    error report. However you can set this parameter to ``'always'`` to send error
    reports without asking for confirmation or you can set it to ``'never'`` to
    never send error reports.

    This directive is available both in the configuration file and in users
    preferences. If the person in charge of a multi-user installation prefers
    to disable this feature for all users, a value of ``'never'`` should be
    set, and the :config:option:`$cfg['UserprefsDisallow']` directive should
    contain ``'SendErrorReports'`` in one of its array values.

.. config:option:: $cfg['ConsoleEnterExecutes']

    :type: boolean
    :default: false

    Setting this to ``true`` allows the user to execute queries by pressing Enter
    instead of Ctrl+Enter. A new line can be inserted by pressing Shift+Enter.

    The behaviour of the console can be temporarily changed using console's
    settings interface.

.. config:option:: $cfg['AllowThirdPartyFraming']

    :type: boolean|string
    :default: false

    Setting this to ``true`` allows BetterMyAdmin to be included inside a frame,
    and is a potential security hole allowing cross-frame scripting attacks or
    clickjacking. Setting this to 'sameorigin' prevents BetterMyAdmin to be
    included from another document in a frame, unless that document belongs
    to the same domain.

    Besides the ``Content-Security-Policy`` ``frame-ancestors`` rule that
    phpMyAdmin sends, BetterMyAdmin also sends a matching ``X-Frame-Options``
    header (``DENY``, or ``SAMEORIGIN`` for 'sameorigin', none for ``true``).

.. _config-bma:

BetterMyAdmin settings
----------------------

These directives are BetterMyAdmin's own; phpMyAdmin has no equivalent, as
they concern what PHP and the web server do for it. Besides those below,
BetterMyAdmin adds :config:option:`$cfg['Servers'][$i]['SignonPage']`,
:config:option:`$cfg['Servers'][$i]['max_connections']`,
:config:option:`$cfg['Export']['csv_escape_formulas']`,
:config:option:`$cfg['Export']['jsmodule_structure_or_data']` and
:config:option:`$cfg['Import']['MaxDecompressedSize']`, and it honours
:config:option:`$cfg['ForceSSL']`, which phpMyAdmin no longer does.

.. config:option:: $cfg['Listen']

    :type: array
    :default: ``{"host": "127.0.0.1", "port": 8080, "basePath": "/"}``

    Where BetterMyAdmin's HTTP server listens. The command-line options
    ``--host`` and ``--port`` override it. In the Docker image the defaults
    are ``0.0.0.0`` and port 80 (``BMA_LISTEN_PORT`` changes the port).

.. config:option:: $cfg['Listen']['host']

    :type: string
    :default: ``'127.0.0.1'``

    The address to listen on. The default accepts connections from the same
    machine only; use ``'0.0.0.0'`` (or a specific address) to accept them from
    the network, preferably behind a reverse proxy with TLS (see
    :ref:`securing`).

.. config:option:: $cfg['Listen']['port']

    :type: integer
    :default: 8080

    The TCP port to listen on.

.. config:option:: $cfg['Listen']['basePath']

    :type: string
    :default: ``'/'``

    The URL path under which users reach BetterMyAdmin, for example
    ``'/bettermyadmin/'`` behind a reverse proxy. BetterMyAdmin's cookies are
    scoped to this path.

.. config:option:: $cfg['DataDir']

    :type: string
    :default: ``'~/.bettermyadmin'``

    The directory where BetterMyAdmin keeps its own data: the sessions
    (:file:`sessions.sqlite`), the generated :config:option:`$cfg['blowfish_secret']`
    (:file:`secret`) and the local metadata store (:file:`local-metadata.sqlite`),
    which keeps per-user data such as recent tables when no
    :ref:`linked-tables` is configured. ``~`` is the home directory of the
    user running BetterMyAdmin. The directory is created (mode ``0700``) if
    it does not exist. In the Docker image it is ``/var/lib/bettermyadmin``;
    mount a volume there to keep the data across container restarts.

    phpMyAdmin keeps sessions where PHP's session settings say
    (:config:option:`$cfg['SessionSavePath']`) and has no local metadata store.

.. config:option:: $cfg['SessionStore']

    :type: string
    :default: ``'sqlite'``

    Where sessions are kept: ``'sqlite'`` stores them in
    :file:`sessions.sqlite` in :config:option:`$cfg['DataDir']`; ``'redis'``
    stores them in the Redis server of :config:option:`$cfg['RedisUrl']`, so
    several BetterMyAdmin processes (behind a load balancer, or replicas of a
    container) share the logins. Each session is one key,
    ``bettermyadmin:session:<id>``, expiring twice the longer of
    :config:option:`$cfg['LoginCookieValidity']` and
    :config:option:`$cfg['LoginCookieStore']` after its last request. When Redis
    cannot be reached or refuses the credentials at start, the server stops with
    the reason; once running, it reconnects by itself. All processes must share
    the same :config:option:`$cfg['blowfish_secret']`.

.. config:option:: $cfg['RedisUrl']

    :type: string
    :default: ``''``

    The Redis server for ``'redis'`` :config:option:`$cfg['SessionStore']`,
    as a URL: ``redis://[[user]:password@]host[:port][/database]``, or
    ``rediss://`` for TLS. For example ``redis://:secret@redis:6379/0``, or
    with environment variables ``BMA__SessionStore=redis`` and
    ``BMA__RedisUrl=redis://:secret@redis:6379/0``. It may contain a password,
    so it is treated as a secret and never shown to users.

.. config:option:: $cfg['MaxUploadSize']

    :type: integer [number of bytes]
    :default: 536870912 (512 MiB)

    The largest file a user can upload, for example to import it. phpMyAdmin
    is limited by PHP's ``upload_max_filesize`` and ``post_max_size``
    settings instead; BetterMyAdmin has no PHP settings, so this directive
    takes their place, and the messages that name the PHP settings in
    phpMyAdmin name it. The Docker variable ``UPLOAD_LIMIT`` (for example
    ``64M``) sets it.

    .. seealso:: :ref:`faq1_16`, :config:option:`$cfg['Import']['MaxDecompressedSize']`

.. config:option:: $cfg['LoginRateLimit']

    :type: array
    :default: ``{"enabled": true, "maxAttempts": 5, "windowSeconds": 900, "lockoutSeconds": 300}``

    Limits failed logins, for cookie and :term:`HTTP` authentication:
    ``maxAttempts`` failed logins of one (IP address, username) pair within
    ``windowSeconds`` lock that pair out for ``lockoutSeconds``, with the
    message "Too many failed login attempts. Please try again in %s
    seconds." It is on by default. phpMyAdmin has no such limit and relies on
    the optional captcha (:config:option:`$cfg['CaptchaLoginPublicKey']`),
    which BetterMyAdmin supports too.

.. config:option:: $cfg['LoginRateLimit']['enabled']

    :type: boolean
    :default: true

    Whether failed logins are limited.

.. config:option:: $cfg['LoginRateLimit']['maxAttempts']

    :type: integer
    :default: 5

    The number of failed logins that locks a pair out.

.. config:option:: $cfg['LoginRateLimit']['windowSeconds']

    :type: integer [number of seconds]
    :default: 900

    The period in which the failed logins are counted.

.. config:option:: $cfg['LoginRateLimit']['lockoutSeconds']

    :type: integer [number of seconds]
    :default: 300

    How long a locked-out pair has to wait.

.. config:option:: $cfg['TransformationsExternalPrograms']

    :type: array [list of strings]
    :default: ``[]``

    The programs that the "External" transformation
    (``Text/Plain: External``, see :ref:`transformations`) may run. Each entry
    is a program with its fixed arguments, for example ``"/usr/bin/tidy -q"``.
    Empty (the default): the transformation shows the value unchanged.

    In phpMyAdmin this list is the ``$allowedPrograms`` array, which an
    administrator edits in the plugin's PHP file. In BetterMyAdmin the
    programs run on the server without a shell: the configured words are the
    program and its fixed arguments, and the column's transformation options
    can only add arguments, never shell syntax. A program is stopped after 10
    seconds and its output is limited to 16 MiB.

    .. warning::

        Any user who can set a column's transformation options can add
        arguments to the program and feed it any cell value: list only
        programs that cannot write or read files through their arguments, or
        wrapper scripts that ignore them.

    .. code-block:: json

        { "TransformationsExternalPrograms": ["/usr/bin/tidy -q"] }

.. config:option:: $cfg['ConnectionPool']

    :type: array
    :default: ``{"idleTimeout": 10, "maxTotal": 50, "waitTimeout": 30}``

    phpMyAdmin opens a MySQL connection for every request. BetterMyAdmin
    keeps connections open between requests, per session and server (at
    most :config:option:`$cfg['Servers'][$i]['max_connections']` each), and
    runs the same session set-up statements once per new connection.

.. config:option:: $cfg['ConnectionPool']['idleTimeout']

    :type: integer [number of seconds]
    :default: 10

    An idle connection is closed after this many seconds.

.. config:option:: $cfg['ConnectionPool']['maxTotal']

    :type: integer
    :default: 50

    The most MySQL connections the whole BetterMyAdmin process holds.

.. config:option:: $cfg['ConnectionPool']['waitTimeout']

    :type: integer [number of seconds]
    :default: 30

    How long a request waits for a connection when they are all in use.

Server connection settings
--------------------------

.. config:option:: $cfg['Servers']

    :type: list
    :default: one server with settings listed below

    BetterMyAdmin supports the administration of multiple MySQL servers. The
    ``Servers`` list contains the login information for the different
    servers: the first entry's :config:option:`$cfg['Servers'][$i]['host']`
    contains the hostname of the first server, the second entry's the hostname
    of the second server, etc. You can put as many entries as you need in the
    configuration file (you don't have to define all settings, just those you
    need to change).

    .. code-block:: json

        {
          "Servers": [
            { "host": "db1.example.org" },
            { "host": "db2.example.org", "verbose": "Second server" }
          ]
        }

    .. note::

        The first entry of the list is server 1 (phpMyAdmin's
        ``$cfg['Servers'][1]``). ``Servers`` may also be written as an object
        whose keys are the server numbers, from 1 (``{"1": {…}, "2": {…}}``).
        In environment variables, servers are numbered from 1:
        ``BMA__Servers__2__host=db2.example.org``.

.. config:option:: $cfg['Servers'][$i]['host']

    :type: string
    :default: ``'localhost'``

    The hostname or :term:`IP` address of your ``$i``-th MySQL-server. E.g.
    ``localhost``.

    Possible values are:

    * hostname, e.g., ``'localhost'`` or ``'mydb.example.org'``
    * IP address, e.g., ``'127.0.0.1'`` or ``'192.168.10.1'``
    * IPv6 address, e.g. ``2001:cdba:0000:0000:0000:0000:3257:9652``
    * dot - ``'.'``, i.e., use named pipes on windows systems
    * empty - ``''``, disables this server

    .. note::

        The hostname ``localhost`` is handled specially by MySQL and it uses
        the socket based connection protocol. To use TCP/IP networking, use an
        IP address or hostname such as ``127.0.0.1`` or ``db.example.com``. You
        can configure the path to the socket with
        :config:option:`$cfg['Servers'][$i]['socket']`.

    .. seealso::

        :config:option:`$cfg['Servers'][$i]['port']`,
        <https://dev.mysql.com/doc/refman/8.0/en/connecting.html>

.. config:option:: $cfg['Servers'][$i]['port']

    :type: string
    :default: ``''``

    The port-number of your ``$i``-th MySQL-server. Default is 3306 (leave
    blank).

    .. note::

       If you use ``localhost`` as the hostname, MySQL ignores this port number
       and connects with the socket, so if you want to connect to a port
       different from the default port, use ``127.0.0.1`` or the real hostname
       in :config:option:`$cfg['Servers'][$i]['host']`.

    .. seealso::

        :config:option:`$cfg['Servers'][$i]['host']`,
        <https://dev.mysql.com/doc/refman/8.0/en/connecting.html>

.. config:option:: $cfg['Servers'][$i]['socket']

    :type: string
    :default: ``''``

    The path to the socket to use. Leave blank for default. To determine
    the correct socket, check your MySQL configuration or, using the
    :command:`mysql` command–line client, issue the ``status`` command. Among the
    resulting information displayed will be the socket used.

    .. note::

        This takes effect only if :config:option:`$cfg['Servers'][$i]['host']` is set
        to ``localhost``.

    .. seealso::

        :config:option:`$cfg['Servers'][$i]['host']`,
        <https://dev.mysql.com/doc/refman/8.0/en/connecting.html>

.. config:option:: $cfg['Servers'][$i]['ssl']

    :type: boolean
    :default: false

    Whether to enable SSL for the connection between BetterMyAdmin and the MySQL
    server to secure the connection.

    .. seealso::

        :ref:`ssl`,
        :ref:`example-google-ssl`,
        :ref:`example-aws-ssl`,
        :config:option:`$cfg['Servers'][$i]['ssl_key']`,
        :config:option:`$cfg['Servers'][$i]['ssl_cert']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca_path']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ciphers']`,
        :config:option:`$cfg['Servers'][$i]['ssl_verify']`

.. config:option:: $cfg['Servers'][$i]['ssl_key']

    :type: string
    :default: NULL

    Path to the client key file when using SSL for connecting to the MySQL
    server. This is used to authenticate the client to the server.

    For example:

    .. code-block:: json

        { "Servers": [{ "ssl_key": "/etc/mysql/server-key.pem" }] }

    .. seealso::

        :ref:`ssl`,
        :ref:`example-google-ssl`,
        :ref:`example-aws-ssl`,
        :config:option:`$cfg['Servers'][$i]['ssl']`,
        :config:option:`$cfg['Servers'][$i]['ssl_cert']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca_path']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ciphers']`,
        :config:option:`$cfg['Servers'][$i]['ssl_verify']`

.. config:option:: $cfg['Servers'][$i]['ssl_cert']

    :type: string
    :default: NULL

    Path to the client certificate file when using SSL for connecting to the
    MySQL server. This is used to authenticate the client to the server.

    .. seealso::

        :ref:`ssl`,
        :ref:`example-google-ssl`,
        :ref:`example-aws-ssl`,
        :config:option:`$cfg['Servers'][$i]['ssl']`,
        :config:option:`$cfg['Servers'][$i]['ssl_key']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca_path']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ciphers']`,
        :config:option:`$cfg['Servers'][$i]['ssl_verify']`

.. config:option:: $cfg['Servers'][$i]['ssl_ca']

    :type: string
    :default: NULL

    Path to the CA file when using SSL for connecting to the MySQL server.

    .. seealso::

        :ref:`ssl`,
        :ref:`example-google-ssl`,
        :ref:`example-aws-ssl`,
        :config:option:`$cfg['Servers'][$i]['ssl']`,
        :config:option:`$cfg['Servers'][$i]['ssl_key']`,
        :config:option:`$cfg['Servers'][$i]['ssl_cert']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca_path']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ciphers']`,
        :config:option:`$cfg['Servers'][$i]['ssl_verify']`

.. config:option:: $cfg['Servers'][$i]['ssl_ca_path']

    :type: string
    :default: NULL

    Directory containing trusted SSL CA certificates in PEM format.

    .. seealso::

        :ref:`ssl`,
        :ref:`example-google-ssl`,
        :ref:`example-aws-ssl`,
        :config:option:`$cfg['Servers'][$i]['ssl']`,
        :config:option:`$cfg['Servers'][$i]['ssl_key']`,
        :config:option:`$cfg['Servers'][$i]['ssl_cert']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ciphers']`,
        :config:option:`$cfg['Servers'][$i]['ssl_verify']`

.. config:option:: $cfg['Servers'][$i]['ssl_ciphers']

    :type: string
    :default: NULL

    List of allowable ciphers for SSL connections to the MySQL server.

    .. seealso::

        :ref:`ssl`,
        :ref:`example-google-ssl`,
        :ref:`example-aws-ssl`,
        :config:option:`$cfg['Servers'][$i]['ssl']`,
        :config:option:`$cfg['Servers'][$i]['ssl_key']`,
        :config:option:`$cfg['Servers'][$i]['ssl_cert']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca_path']`,
        :config:option:`$cfg['Servers'][$i]['ssl_verify']`

.. config:option:: $cfg['Servers'][$i]['ssl_verify']

    :type: boolean
    :default: true

    .. versionadded:: 4.6.0

        This is supported since phpMyAdmin 4.6.0.

    With verification on, the server's certificate must be signed by a trusted
    certificate authority (see :config:option:`$cfg['Servers'][$i]['ssl_ca']`).
    If your SSL certificate is self-signed and not trusted, the connection will
    fail validation. Setting this to ``false`` will disable the validation
    check.

    .. warning::

        Disabling the certificate verification defeats purpose of using SSL.
        This will make the connection vulnerable to man in the middle attacks.

    .. seealso::

        :ref:`ssl`,
        :ref:`example-google-ssl`,
        :ref:`example-aws-ssl`,
        :config:option:`$cfg['Servers'][$i]['ssl']`,
        :config:option:`$cfg['Servers'][$i]['ssl_key']`,
        :config:option:`$cfg['Servers'][$i]['ssl_cert']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca_path']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ciphers']`,
        :config:option:`$cfg['Servers'][$i]['ssl_verify']`

.. config:option:: $cfg['Servers'][$i]['connect_type']

    :type: string
    :default: ``'tcp'``

    .. deprecated:: 4.7.0

       This setting is no longer used as of 4.7.0, since MySQL decides the
       connection type based on host, so it could lead to unexpected results.
       Please set :config:option:`$cfg['Servers'][$i]['host']` accordingly
       instead.

    What type connection to use with the MySQL server. Your options are
    ``'socket'`` and ``'tcp'``. It defaults to tcp as that is nearly guaranteed
    to be available on all MySQL servers, while sockets are not supported on
    some platforms. To use the socket mode, your MySQL server must be on the
    same machine as BetterMyAdmin.

.. config:option:: $cfg['Servers'][$i]['compress']

    :type: boolean
    :default: false

    Whether to enable client/server protocol compression for this
    database server connection (experimental).

    When enabled, BetterMyAdmin asks the MySQL client library (mysql2) for a
    compressed connection, so that traffic between the BetterMyAdmin server and
    the database server is compressed. This affects only the database connection
    protocol. It does not compress SQL dumps, CSV/export downloads, or HTTP
    responses to the browser.

    Compression can help on slow or metered links between BetterMyAdmin and the
    database server. On a local or low-latency network the CPU cost often
    outweighs any bandwidth savings, so leave this disabled unless you
    measure a benefit.

    .. seealso::

        - `MySQL connection compression control <https://dev.mysql.com/doc/refman/en/connection-compression-control.html>`_

.. _controlhost:
.. config:option:: $cfg['Servers'][$i]['controlhost']

    :type: string
    :default: ``''``

    Permits to use an alternate host to hold the configuration storage
    data.

    .. seealso::

        :config:option:`$cfg['Servers'][$i]['control_*']`

.. _controlport:
.. config:option:: $cfg['Servers'][$i]['controlport']

    :type: string
    :default: ``''``

    Permits to use an alternate port to connect to the host that
    holds the configuration storage.

    .. seealso::

        :config:option:`$cfg['Servers'][$i]['control_*']`

.. _controluser:
.. config:option:: $cfg['Servers'][$i]['controluser']

    :type: string
    :default: ``''``

.. config:option:: $cfg['Servers'][$i]['controlpass']

    :type: string
    :default: ``''``

    This special account is used to access :ref:`linked-tables`.
    You don't need it in single user case, but if BetterMyAdmin is shared it
    is recommended to give access to :ref:`linked-tables` only to this user
    and configure BetterMyAdmin to use it. All users will then be able to use
    the features without need to have direct access to :ref:`linked-tables`.

    .. versionchanged:: 2.2.5
        those were called ``stduser`` and ``stdpass``

    .. seealso::

        :ref:`setup`,
        :ref:`authentication_modes`,
        :ref:`linked-tables`,
        :config:option:`$cfg['Servers'][$i]['pmadb']`,
        :config:option:`$cfg['Servers'][$i]['controlhost']`,
        :config:option:`$cfg['Servers'][$i]['controlport']`,
        :config:option:`$cfg['Servers'][$i]['control_*']`

.. config:option:: $cfg['Servers'][$i]['control_*']

    :type: mixed

    .. versionadded:: 4.7.0

    You can change any MySQL connection setting for control link (used to
    access :ref:`linked-tables`) using configuration prefixed with ``control_``.

    This can be used to change any aspect of the control connection, which by
    default uses same parameters as the user one.

    For example you can configure SSL for the control connection:

    .. code-block:: json

        {
          "Servers": [{
            "control_ssl": true,
            "control_ssl_key": "../client-key.pem",
            "control_ssl_cert": "../client-cert.pem",
            "control_ssl_ca": "../server-ca.pem"
          }]
        }

    .. seealso::

        :config:option:`$cfg['Servers'][$i]['ssl']`,
        :config:option:`$cfg['Servers'][$i]['ssl_key']`,
        :config:option:`$cfg['Servers'][$i]['ssl_cert']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ca_path']`,
        :config:option:`$cfg['Servers'][$i]['ssl_ciphers']`,
        :config:option:`$cfg['Servers'][$i]['ssl_verify']`,
        :config:option:`$cfg['Servers'][$i]['socket']`,
        :config:option:`$cfg['Servers'][$i]['compress']`,
        :config:option:`$cfg['Servers'][$i]['hide_connection_errors']`

.. config:option:: $cfg['Servers'][$i]['auth_type']

    :type: string
    :default: ``'cookie'``

    Whether config or cookie or :term:`HTTP` or signon authentication should be
    used for this server.

    * 'config' authentication (``"auth_type": "config"``) is the plain old
      way: username and password are stored in the configuration file.
    * 'cookie' authentication mode (``"auth_type": "cookie"``) allows you to
      log in as any valid MySQL user with a login form.
    * 'http' authentication allows you to log in as any
      valid MySQL user via HTTP-Auth.
    * 'signon' authentication mode (``"auth_type": "signon"``) allows you to
      log in with credentials handed over by another application, or returned
      by a JavaScript module.

    .. seealso:: :ref:`authentication_modes`

.. _servers_auth_http_realm:
.. config:option:: $cfg['Servers'][$i]['auth_http_realm']

    :type: string
    :default: ``''``

    When using ``'http'`` for :config:option:`$cfg['Servers'][$i]['auth_type']`, this field allows to define a custom
    :term:`HTTP` Basic Auth Realm which will be displayed to the user. If not
    explicitly specified in your configuration, a string combined of
    "BetterMyAdmin " and either :config:option:`$cfg['Servers'][$i]['verbose']` or
    :config:option:`$cfg['Servers'][$i]['host']` will be used.

.. _servers_auth_swekey_config:
.. config:option:: $cfg['Servers'][$i]['auth_swekey_config']

    :type: string
    :default: ``''``

    .. versionadded:: 3.0.0.0

        This setting was named ``$cfg['Servers'][$i]['auth_feebee_config']`` and was renamed before the `3.0.0.0` release.

    .. deprecated:: 4.6.4

        This setting was removed because their servers are no longer working and it was not working correctly.

    .. deprecated:: 4.0.10.17

        This setting was removed in a maintenance release because their servers are no longer working and it was not working correctly.

    The name of the file containing swekey ids and login names for hardware
    authentication. Leave empty to deactivate this feature.

.. _servers_user:
.. config:option:: $cfg['Servers'][$i]['user']

    :type: string
    :default: ``'root'``

.. config:option:: $cfg['Servers'][$i]['password']

    :type: string
    :default: ``''``

    When using :config:option:`$cfg['Servers'][$i]['auth_type']` set to
    ``'config'``, this is the user/password-pair which BetterMyAdmin will use to
    connect to the MySQL server. This user/password pair is not needed when
    :term:`HTTP` or cookie authentication is used
    and should be empty.

.. _servers_nopassword:
.. config:option:: $cfg['Servers'][$i]['nopassword']

    :type: boolean
    :default: false

    .. deprecated:: 4.7.0

        This setting was removed as it can produce unexpected results.

    Allow attempt to log in without password when a login with password
    fails. This can be used together with http authentication, when
    authentication is done some other way and phpMyAdmin gets user name
    from auth and uses empty password for connecting to MySQL. Password
    login is still tried first, but as fallback, no password method is
    tried.

    .. note::

        It is possible to allow logging in with no password with
        the :config:option:`$cfg['Servers'][$i]['AllowNoPassword']` directive.

.. _servers_only_db:
.. config:option:: $cfg['Servers'][$i]['only_db']

    :type: string or array
    :default: ``''``

    If set to a (an array of) database name(s), only this (these)
    database(s) will be shown to the user. These database names may contain
    MySQL wildcards characters
    ("\_" and "%"): if you want to use literal instances of these
    characters, escape them (I.E. use ``'my\_db'`` and not ``'my_db'``).

    This setting is an efficient way to lower the server load since the
    latter does not need to send MySQL requests to build the available
    database list. But **it does not replace the privileges rules of the
    MySQL database server**. If set, it just means only these databases
    will be displayed but **not that all other databases can't be used.**

    An example of using more than one database:

    .. code-block:: json

        { "Servers": [{ "only_db": ["db1", "db2"] }] }

    .. versionchanged:: 4.0.0
        Previous versions permitted to specify the display order of
        the database names via this directive.

.. config:option:: $cfg['Servers'][$i]['hide_db']

    :type: string
    :default: ``''``

    Regular expression for hiding some databases from unprivileged users.
    This only hides them from listing, but a user is still able to access
    them (using, for example, the SQL query area). To limit access, use
    the MySQL privilege system. For example, to hide all databases
    starting with the letter "a", use

    .. code-block:: json

        { "Servers": [{ "hide_db": "^a" }] }

    and to hide both "db1" and "db2" use

    .. code-block:: json

        { "Servers": [{ "hide_db": "^(db1|db2)$" }] }

    The pattern is a JavaScript regular expression (without delimiters); for
    simple patterns like these it means the same as phpMyAdmin's PCRE. More
    information can be found in the `regular expressions guide
    <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions>`_.

.. config:option:: $cfg['Servers'][$i]['verbose']

    :type: string
    :default: ``''``

    Only useful when using BetterMyAdmin with multiple server entries. If
    set, this string will be displayed instead of the hostname in the
    pull-down menu on the main page. This can be useful if you want to
    show only certain databases on your system, for example. For HTTP
    auth, all non-US-ASCII characters will be stripped.

.. config:option:: $cfg['Servers'][$i]['extension']

    :type: string
    :default: ``'mysqli'``

    .. deprecated:: 4.2.0

        This setting was removed. The ``mysql`` extension will only be used when
        the ``mysqli`` extension is not available. As of 5.0.0, only the
        ``mysqli`` extension can be used.

    The PHP MySQL extension to use (``mysql`` or ``mysqli``).

    .. note::

        This directive has no effect in BetterMyAdmin, which is not PHP: it
        connects with the `mysql2 <https://www.npmjs.com/package/mysql2>`_
        Node.js driver.

.. config:option:: $cfg['Servers'][$i]['pmadb']

    :type: string
    :default: ``''``

    The name of the database containing the phpMyAdmin configuration
    storage.

    See the :ref:`linked-tables`  section in this document to see the benefits of
    this feature, and for a quick way of creating this database and the needed
    tables.

    If you are the only user of this BetterMyAdmin installation, you can use your
    current database to store those special tables; in this case, just put your
    current database name in :config:option:`$cfg['Servers'][$i]['pmadb']`. For a
    multi-user installation, set this parameter to the name of your central
    database containing the phpMyAdmin configuration storage.

.. _bookmark:
.. config:option:: $cfg['Servers'][$i]['bookmarktable']

    :type: string or false
    :default: ``''``

    .. versionadded:: 2.2.0

    BetterMyAdmin allows users to bookmark queries. This
    can be useful for queries you often run. To allow the usage of this
    functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * enter the table name in :config:option:`$cfg['Servers'][$i]['bookmarktable']`

    This feature can be disabled by setting the configuration to ``false``.

.. _relation:
.. config:option:: $cfg['Servers'][$i]['relation']

    :type: string or false
    :default: ``''``

    .. versionadded:: 2.2.4

    You can describe, in a special 'relation' table,
    which column is a key in another table (a foreign key). BetterMyAdmin
    currently uses this to:

    * make clickable, when you browse the master table, the data values that
      point to the foreign table;
    * display in an optional tool-tip the "display column" when browsing the
      master table, if you move the mouse to a column containing a foreign
      key (use also the ``table_info`` table); (see :ref:`faqdisplay`)
    * in edit/insert mode, display a drop-down list of possible foreign keys
      (key value and "display column" are shown) (see :ref:`faq6_21`)
    * display links on the table properties page, to check referential
      integrity (display missing foreign keys) for each described key;
    * in query-by-example, create automatic joins (see :ref:`faq6_6`)
    * enable you to get a :term:`PDF` schema of
      your database (also uses the ``table_coords`` table).

    The keys can be numeric or character.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the relation table name in :config:option:`$cfg['Servers'][$i]['relation']`
    * now as normal user open BetterMyAdmin and for each one of your tables
      where you want to use this feature, click :guilabel:`Structure/Relation view/`
      and choose foreign columns.

    This feature can be disabled by setting the configuration to ``false``.

    .. note::

        In the current version, ``master_db`` must be the same as ``foreign_db``.
        Those columns have been put in future development of the cross-db
        relations.

.. _table_info:
.. config:option:: $cfg['Servers'][$i]['table_info']

    :type: string or false
    :default: ``''``

    .. versionadded:: 2.3.0

    You can describe, in a special ``table_info``
    table, which column is to be displayed as a tool-tip when moving the
    cursor over the corresponding key. This configuration variable will
    hold the name of this special table. To allow the usage of this
    functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['table\_info']` (e.g.
      ``pma__table_info``)
    * then for each table where you want to use this feature, click
      "Structure/Relation view/Choose column to display" to choose the
      column.

    This feature can be disabled by setting the configuration to ``false``.

    .. seealso:: :ref:`faqdisplay`

.. _table_coords:
.. config:option:: $cfg['Servers'][$i]['table_coords']

    :type: string or false
    :default: ``''``

    The designer feature can save your page layout; by pressing the "Save page" or "Save page as"
    button in the expanding designer menu, you can customize the layout and have it loaded the next
    time you use the designer. That layout is stored in this table. Furthermore, this table is also
    required for using the PDF relation export feature, see
    :config:option:`$cfg['Servers'][$i]['pdf\_pages']` for additional details.

.. config:option:: $cfg['Servers'][$i]['pdf_pages']

    :type: string or false
    :default: ``''``

    .. versionadded:: 2.3.0

    You can have BetterMyAdmin create :term:`PDF` pages
    showing the relations between your tables. Further, the designer interface
    permits visually managing the relations. To do this it needs two tables
    "``pdf_pages``" (storing information about the available :term:`PDF` pages)
    and "``table_coords``" (storing coordinates where each table will be placed on
    a :term:`PDF` schema output). You must be using the "relation" feature.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the correct table names in
      :config:option:`$cfg['Servers'][$i]['table\_coords']` and
      :config:option:`$cfg['Servers'][$i]['pdf\_pages']`

    This feature can be disabled by setting either of the configurations to ``false``.

    .. seealso:: :ref:`faqpdf`.

.. _designer_coords:
.. config:option:: $cfg['Servers'][$i]['designer_coords']

    :type: string
    :default: ``''``

    .. versionadded:: 2.10.0

        Since release 2.10.0 a Designer interface is available; it permits to
        visually manage the relations.

    .. deprecated:: 4.3.0

        This setting was removed and the Designer table positioning data is now stored into :config:option:`$cfg['Servers'][$i]['table\_coords']`.

    .. note::
        You can now delete the table `pma__designer_coords` from your phpMyAdmin configuration storage database and remove :config:option:`$cfg['Servers'][$i]['designer\_coords']` from your configuration file.

.. _col_com:
.. config:option:: $cfg['Servers'][$i]['column_info']

    :type: string or false
    :default: ``''``

    .. versionadded:: 2.3.0

    This part requires a content update!  You can
    store comments to describe each column for each table. These will then
    be shown on the "printview".

    Starting with release 2.5.0, comments are consequently used on the table
    property pages and table browse view, showing up as tool-tips above the
    column name (properties page) or embedded within the header of table in
    browse view. They can also be shown in a table dump. Please see the
    relevant configuration directives later on.

    Also new in release 2.5.0 is a MIME- transformation system which is also
    based on the following table structure. See :ref:`transformations` for
    further information. To use the MIME- transformation system, your
    ``column_info`` table has to have the three new columns ``'mimetype'``,
    ``'transformation'``, ``'transformation_options'``.

    Starting with release 4.3.0, a new input-oriented transformation system
    has been introduced. Also, backward compatibility code used in the old
    transformations system was removed. As a result, an update to ``column_info``
    table is necessary for previous transformations and the new input-oriented
    transformation system to work. BetterMyAdmin will upgrade it automatically
    for you by analyzing your current ``column_info`` table structure.
    However, if something goes wrong with the auto-upgrade then you can
    use the SQL script found in the repository at
    :file:`packages/metadata/resources/upgrade_column_info_4_3_0+.sql`
    to upgrade it manually.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['column\_info']` (e.g.
      ``pma__column_info``)
    * to update your PRE-2.5.0 ``column_comments`` table use this:  and
      remember that the directive has been renamed from
      :samp:`$cfg['Servers'][$i]['column\_comments']` to
      :config:option:`$cfg['Servers'][$i]['column\_info']`

      .. code-block:: mysql

           ALTER TABLE `pma__column_comments`
           ADD `mimetype` VARCHAR(255) NOT NULL,
           ADD `transformation` VARCHAR(255) NOT NULL,
           ADD `transformation_options` VARCHAR(255) NOT NULL;
    * to update your PRE-4.3.0 ``column_info`` table manually use the
      :file:`packages/metadata/resources/upgrade_column_info_4_3_0+.sql` SQL script.

    This feature can be disabled by setting the configuration to ``false``.

    .. note::

        For auto-upgrade functionality to work, your
        :config:option:`$cfg['Servers'][$i]['controluser']` must have ALTER privilege on
        ``phpmyadmin`` database. See the `MySQL documentation for GRANT
        <https://dev.mysql.com/doc/refman/8.0/en/grant.html>`_ on how to
        ``GRANT`` privileges to a user.

.. _history:
.. config:option:: $cfg['Servers'][$i]['history']

    :type: string or false
    :default: ``''``

    .. versionadded:: 2.5.0

    You can store your :term:`SQL` history, which means all
    queries you entered manually into the BetterMyAdmin interface. If you don't
    want to use a table-based history, you can use the JavaScript-based
    history.

    Using that, all your history items are deleted when closing the window.
    Using :config:option:`$cfg['QueryHistoryMax']` you can specify an amount of
    history items you want to have on hold. On every login, this list gets cut
    to the maximum amount.

    The query history is only available if JavaScript is enabled in
    your browser.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['history']` (e.g.
      ``pma__history``)

    This feature can be disabled by setting the configuration to ``false``.

.. _recent:
.. config:option:: $cfg['Servers'][$i]['recent']

    :type: string or false
    :default: ``''``

    .. versionadded:: 3.5.0

    You can show recently used tables in the
    navigation panel. It helps you to jump across table directly, without
    the need to select the database, and then select the table. Using
    :config:option:`$cfg['NumRecentTables']` you can configure the maximum number
    of recent tables shown. When you select a table from the list, it will jump to
    the page specified in :config:option:`$cfg['NavigationTreeDefaultTabTable']`.

    Without configuring the storage, you can still access the recently used tables,
    but it will disappear after you logout.

    To allow the usage of this functionality persistently:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['recent']` (e.g.
      ``pma__recent``)

    This feature can be disabled by setting the configuration to ``false``.

.. _favorite:
.. config:option:: $cfg['Servers'][$i]['favorite']

    :type: string or false
    :default: ``''``

    .. versionadded:: 4.2.0

    You can show a list of selected tables in the
    navigation panel. It helps you to jump to the table directly, without
    the need to select the database, and then select the table. When you
    select a table from the list, it will jump to the page specified in
    :config:option:`$cfg['NavigationTreeDefaultTabTable']`.

    You can add tables to this list or remove tables from it in database
    structure page by clicking on the star icons next to table names. Using
    :config:option:`$cfg['NumFavoriteTables']` you can configure the maximum
    number of favorite tables shown.

    Without configuring the storage, you can still access the favorite tables,
    but it will disappear after you logout.

    To allow the usage of this functionality persistently:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['favorite']` (e.g.
      ``pma__favorite``)

    This feature can be disabled by setting the configuration to ``false``.

.. _table_uiprefs:
.. config:option:: $cfg['Servers'][$i]['table_uiprefs']

    :type: string or false
    :default: ``''``

    .. versionadded:: 3.5.0

    BetterMyAdmin can be configured to remember several
    things (sorted column :config:option:`$cfg['RememberSorting']`, column order,
    and column visibility from a database table) for browsing tables. Without
    configuring the storage, these features still can be used, but the values will
    disappear after you logout.

    To allow the usage of these functionality persistently:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['table\_uiprefs']` (e.g.
      ``pma__table_uiprefs``)

    This feature can be disabled by setting the configuration to ``false``.

.. config:option:: $cfg['Servers'][$i]['users']

    :type: string or false
    :default: ``''``

    The table used by BetterMyAdmin to store user name information for associating with user groups.
    See the next entry on :config:option:`$cfg['Servers'][$i]['usergroups']` for more details
    and the suggested settings.

.. config:option:: $cfg['Servers'][$i]['usergroups']

    :type: string or false
    :default: ``''``

    .. versionadded:: 4.1.0

    You can create different user groups with menu items
    attached to them. Users can be assigned to these groups and the logged in
    user would only see menu items configured to the usergroup they are assigned to.
    To do this it needs two tables "usergroups" (storing allowed menu items for each
    user group) and "users" (storing users and their assignments to user groups).

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the correct table names in
      :config:option:`$cfg['Servers'][$i]['users']` (e.g. ``pma__users``) and
      :config:option:`$cfg['Servers'][$i]['usergroups']` (e.g. ``pma__usergroups``)

    This feature can be disabled by setting either of the configurations to ``false``.

    .. seealso:: :ref:`configurablemenus`

.. _navigationhiding:
.. config:option:: $cfg['Servers'][$i]['navigationhiding']

    :type: string or false
    :default: ``''``

    .. versionadded:: 4.1.0

    You can hide/show items in the navigation tree.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['navigationhiding']` (e.g.
      ``pma__navigationhiding``)

    This feature can be disabled by setting the configuration to ``false``.

.. _central_columns:
.. config:option:: $cfg['Servers'][$i]['central_columns']

    :type: string or false
    :default: ``''``

    .. versionadded:: 4.3.0

    You can have a central list of columns per database.
    You can add/remove columns to the list as per your requirement. These columns
    in the central list will be available to use while you create a new column for
    a table or create a table itself. You can select a column from central list
    while creating a new column, it will save you from writing the same column definition
    over again or from writing different names for similar column.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['central_columns']` (e.g.
      ``pma__central_columns``)

    This feature can be disabled by setting the configuration to ``false``.

.. _designer_settings:
.. config:option:: $cfg['Servers'][$i]['designer_settings']

    :type: string or false
    :default: ``''``

    .. versionadded:: 4.5.0

    Your designer settings can be remembered.
    Your choice regarding 'Angular/Direct Links', 'Snap to Grid', 'Toggle Relation Lines',
    'Small/Big All', 'Move Menu' and 'Pin Text' can be remembered persistently.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['designer_settings']` (e.g.
      ``pma__designer_settings``)

    This feature can be disabled by setting the configuration to ``false``.

.. _savedsearches:
.. config:option:: $cfg['Servers'][$i]['savedsearches']

    :type: string or false
    :default: ``''``

    .. versionadded:: 4.2.0

    You can save and load query-by-example searches from the Database > Query panel.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['savedsearches']` (e.g.
      ``pma__savedsearches``)

    This feature can be disabled by setting the configuration to ``false``.

.. _export_templates:
.. config:option:: $cfg['Servers'][$i]['export_templates']

    :type: string or false
    :default: ``''``

    .. versionadded:: 4.5.0

    You can save and load export templates.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['export_templates']` (e.g.
      ``pma__export_templates``)

    This feature can be disabled by setting the configuration to ``false``.

.. _tracking:
.. config:option:: $cfg['Servers'][$i]['tracking']

    :type: string or false
    :default: ``''``

    .. versionadded:: 3.3.x

    Since release 3.3.x a tracking mechanism is available. It helps you to
    track every :term:`SQL` command which is
    executed by BetterMyAdmin. The mechanism supports logging of data
    manipulation and data definition statements. After enabling it you can
    create versions of tables.

    The creation of a version has two effects:

    * BetterMyAdmin saves a snapshot of the table, including structure and
      indexes.
    * BetterMyAdmin logs all commands which change the structure and/or data of
      the table and links these commands with the version number.

    Of course you can view the tracked changes. On the :guilabel:`Tracking`
    page a complete report is available for every version. For the report you
    can use filters, for example you can get a list of statements within a date
    range. When you want to filter usernames you can enter \* for all names or
    you enter a list of names separated by ','. In addition you can export the
    (filtered) report to a file or to a temporary database.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['tracking']` (e.g.
      ``pma__tracking``)

    This feature can be disabled by setting the configuration to ``false``.

.. _tracking2:
.. config:option:: $cfg['Servers'][$i]['tracking_version_auto_create']

    :type: boolean
    :default: false

    Whether the tracking mechanism creates versions for tables and views
    automatically.

    If this is set to true and you create a table or view with

    * CREATE TABLE ...
    * CREATE VIEW ...

    and no version exists for it, the mechanism will create a version for
    you automatically.

.. _tracking3:
.. config:option:: $cfg['Servers'][$i]['tracking_default_statements']

    :type: string
    :default: ``'CREATE TABLE,ALTER TABLE,DROP TABLE,RENAME TABLE,CREATE INDEX,DROP INDEX,INSERT,UPDATE,DELETE,TRUNCATE,REPLACE,CREATE VIEW,ALTER VIEW,DROP VIEW,CREATE DATABASE,ALTER DATABASE,DROP DATABASE'``

    Defines the list of statements the auto-creation uses for new
    versions.

.. _tracking4:
.. config:option:: $cfg['Servers'][$i]['tracking_add_drop_view']

    :type: boolean
    :default: true

    Whether a `DROP VIEW IF EXISTS` statement will be added as first line to
    the log when creating a view.

.. _tracking5:
.. config:option:: $cfg['Servers'][$i]['tracking_add_drop_table']

    :type: boolean
    :default: true

    Whether a `DROP TABLE IF EXISTS` statement will be added as first line
    to the log when creating a table.

.. _tracking6:
.. config:option:: $cfg['Servers'][$i]['tracking_add_drop_database']

    :type: boolean
    :default: true

    Whether a `DROP DATABASE IF EXISTS` statement will be added as first
    line to the log when creating a database.

.. _userconfig:
.. config:option:: $cfg['Servers'][$i]['userconfig']

    :type: string or false
    :default: ``''``

    .. versionadded:: 3.4.x

    BetterMyAdmin allows users to set most preferences by
    themselves and store them in the database.

    If you don't allow for storing preferences in
    :config:option:`$cfg['Servers'][$i]['pmadb']`, users can still personalize
    BetterMyAdmin, but settings will be saved in browser's local storage, or, it
    is is unavailable, until the end of session.

    To allow the usage of this functionality:

    * set up :config:option:`$cfg['Servers'][$i]['pmadb']` and the phpMyAdmin configuration storage
    * put the table name in :config:option:`$cfg['Servers'][$i]['userconfig']`

    This feature can be disabled by setting the configuration to ``false``.

.. config:option:: $cfg['Servers'][$i]['MaxTableUiprefs']

    :type: integer
    :default: 100

    Maximum number of rows saved in
    :config:option:`$cfg['Servers'][$i]['table_uiprefs']` table.

    When tables are dropped or renamed,
    :config:option:`$cfg['Servers'][$i]['table_uiprefs']` may contain invalid data
    (referring to tables which no longer exist). We only keep this number of newest
    rows in :config:option:`$cfg['Servers'][$i]['table_uiprefs']` and automatically
    delete older rows.

.. config:option:: $cfg['Servers'][$i]['SessionTimeZone']

    :type: string
    :default: ``''``

    Sets the time zone used by BetterMyAdmin. Leave blank to use the time zone of your
    database server. Possible values are explained at
    https://dev.mysql.com/doc/refman/8.0/en/time-zone-support.html

    This is useful when your database server uses a time zone which is different from the
    time zone you want to use in BetterMyAdmin.

.. config:option:: $cfg['Servers'][$i]['AllowRoot']

    :type: boolean
    :default: true

    Whether to allow root access. This is just a shortcut for the
    :config:option:`$cfg['Servers'][$i]['AllowDeny']['rules']` below.

.. config:option:: $cfg['Servers'][$i]['AllowNoPassword']

    :type: boolean
    :default: false

    Whether to allow logins without a password. The default value of
    ``false`` for this parameter prevents unintended access to a MySQL
    server with was left with an empty password for root or on which an
    anonymous (blank) user is defined.

.. _servers_allowdeny_order:
.. config:option:: $cfg['Servers'][$i]['AllowDeny']['order']

    :type: string
    :default: ``''``

    If your rule order is empty, then :term:`IP`
    authorization is disabled.

    If your rule order is set to
    ``'deny,allow'`` then the system applies all deny rules followed by
    allow rules. Access is allowed by default. Any client which does not
    match a Deny command or does match an Allow command will be allowed
    access to the server.

    If your rule order is set to ``'allow,deny'``
    then the system applies all allow rules followed by deny rules. Access
    is denied by default. Any client which does not match an Allow
    directive or does match a Deny directive will be denied access to the
    server.

    If your rule order is set to ``'explicit'``, authorization is
    performed in a similar fashion to rule order 'deny,allow', with the
    added restriction that your host/username combination **must** be
    listed in the *allow* rules, and not listed in the *deny* rules. This
    is the **most** secure means of using Allow/Deny rules, and was
    available in Apache by specifying allow and deny rules without setting
    any order.

    Please also see :config:option:`$cfg['TrustedProxies']` for
    detecting IP address behind proxies.

.. _servers_allowdeny_rules:
.. config:option:: $cfg['Servers'][$i]['AllowDeny']['rules']

    :type: array of strings
    :default: ``[]``

    The general format for the rules is as such:

    .. code-block:: none

        <'allow' | 'deny'> <username> [from] <ipmask>

    If you wish to match all users, it is possible to use a ``'%'`` as a
    wildcard in the *username* field.

    There are a few shortcuts you can
    use in the *ipmask* field as well (``SERVER_ADDRESS`` is read from the
    ``SERVER_ADDR`` environment variable of the BetterMyAdmin process; without
    it, the ``localnet`` shortcuts match nothing):

    .. code-block:: none

        'all' -> 0.0.0.0/0
        'localhost' -> 127.0.0.1/8
        'localnetA' -> SERVER_ADDRESS/8
        'localnetB' -> SERVER_ADDRESS/16
        'localnetC' -> SERVER_ADDRESS/24

    Having an empty rule list is equivalent to either using ``'allow %
    from all'`` if your rule order is set to ``'deny,allow'`` or ``'deny %
    from all'`` if your rule order is set to ``'allow,deny'`` or
    ``'explicit'``.

    For the :term:`IP Address` matching
    system, the following work:

    * ``xxx.xxx.xxx.xxx`` (an exact :term:`IP Address`)
    * ``xxx.xxx.xxx.[yyy-zzz]`` (an :term:`IP Address` range)
    * ``xxx.xxx.xxx.xxx/nn`` (CIDR, Classless Inter-Domain Routing type :term:`IP` addresses)

    But the following does not work:

    * ``xxx.xxx.xxx.xx[yyy-zzz]`` (partial :term:`IP` address range)

    For :term:`IPv6` addresses, the following work:

    * ``xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx`` (an exact :term:`IPv6` address)
    * ``xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:[yyyy-zzzz]`` (an :term:`IPv6` address range)
    * ``xxxx:xxxx:xxxx:xxxx/nn`` (CIDR, Classless Inter-Domain Routing type :term:`IPv6` addresses)

    But the following does not work:

    * ``xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx:xx[yyy-zzz]`` (partial :term:`IPv6` address range)

    Examples:

    Allow only 'bob' to connect from any host:

    .. code-block:: json

        { "Servers": [{ "AllowDeny": { "order": "allow,deny", "rules": ["allow bob from all"] } }] }

    Allow only 'mary' to connect from host 192.168.100.50 through 192.168.100.100:

    .. code-block:: json

        { "Servers": [{ "AllowDeny": { "order": "allow,deny", "rules": ["allow mary from 192.168.100.[50-100]"] } }] }

    Allow any user to connect from host 192.168.5.10 or 192.168.6.10:

    .. code-block:: json

        { "Servers": [{ "AllowDeny": { "order": "allow,deny", "rules": ["allow % from 192.168.[5-6].10"] } }] }

    Allow any user to connect from 192.168.6.10, and additionally allow root to
    connect from 192.168.5.50:

    .. code-block:: json

        {
          "Servers": [{
            "AllowDeny": {
              "order": "allow,deny",
              "rules": ["allow root from 192.168.5.50", "allow % from 192.168.6.10"]
            }
          }]
        }

.. config:option:: $cfg['Servers'][$i]['DisableIS']

    :type: boolean
    :default: false

    Disable using ``INFORMATION_SCHEMA`` to retrieve information (use
    ``SHOW`` commands instead), because of speed issues when many
    databases are present.

    .. note::

        Enabling this option might give you a big performance boost on older
        MySQL servers.

.. config:option:: $cfg['Servers'][$i]['SignonScript']

    :type: string
    :default: ``''``

    .. versionadded:: 3.5.0

    Path of a JavaScript or TypeScript module to be imported to obtain login
    credentials. This is alternative approach to session based single
    signon. The module has to export a function called
    ``getLoginCredentials`` which returns (or resolves to) a list of username
    and password, accepting single parameter of existing username (can be
    empty). A relative path is resolved against BetterMyAdmin's working
    directory. See :file:`apps/server/examples/signon-script.ts` for an
    example:

    .. literalinclude:: ../apps/server/examples/signon-script.ts
        :language: ts

    .. note::

        In phpMyAdmin this is a PHP file defining ``get_login_credentials()``;
        BetterMyAdmin cannot run PHP, so the script has to be ported. A ``.ts``
        module needs a TypeScript-aware Node.js (22.18 or later); a ``.mjs`` or
        ``.js`` module works everywhere.

    .. seealso:: :ref:`auth_signon`

.. config:option:: $cfg['Servers'][$i]['SignonSession']

    :type: string
    :default: ``''``

    Name of the cookie which will be used for signon authentication method.
    Takes effect only if
    :config:option:`$cfg['Servers'][$i]['SignonScript']` is not configured.

    In phpMyAdmin this names the other application's PHP session. BetterMyAdmin
    cannot read PHP sessions: the other application hands the credentials over
    in a cookie of this name holding the same ``PMA_single_signon_*`` keys,
    encrypted with a key derived from :config:option:`$cfg['blowfish_secret']`
    (see :file:`apps/server/examples/signon.ts`). Login errors are written back
    into it (``PMA_single_signon_error_message``). The
    ``PMA_single_signon_token`` and ``PMA_single_signon_HMAC_secret`` keys have
    no use in BetterMyAdmin.

    .. seealso:: :ref:`auth_signon`

.. config:option:: $cfg['Servers'][$i]['SignonCookieParams']

    :type: array
    :default: ``[]``

    .. versionadded:: 4.7.0

    An object of cookie parameters of the
    :config:option:`$cfg['Servers'][$i]['SignonSession']` cookie, used when
    BetterMyAdmin rewrites it (for example to store a login error).
    Keys should include ``'lifetime'``, ``'path'``, ``'domain'``, ``'secure'``,
    ``'httponly'`` or ``'samesite'``; they should be set to same values as the
    other application uses. Takes effect only if
    :config:option:`$cfg['Servers'][$i]['SignonScript']` is not configured.

    .. seealso:: :ref:`auth_signon`

.. config:option:: $cfg['Servers'][$i]['SignonURL']

    :type: string
    :default: ``''``

    :term:`URL` where user will be redirected
    to log in for signon authentication method. Should be absolute
    including protocol, or a path on BetterMyAdmin's own host when
    :config:option:`$cfg['Servers'][$i]['SignonPage']` serves the login page.

    .. seealso:: :ref:`auth_signon`

.. config:option:: $cfg['Servers'][$i]['SignonPage']

    :type: string
    :default: ``''``

    BetterMyAdmin only. Path of a JavaScript module that BetterMyAdmin serves
    itself as the login page of a signon server, at the path of a same-host
    :config:option:`$cfg['Servers'][$i]['SignonURL']`, before its login checks.
    A relative path is resolved against BetterMyAdmin's working directory.

    In phpMyAdmin the login page of a signon server is a PHP page that the same
    web server runs next to phpMyAdmin (:file:`examples/signon.php`).
    BetterMyAdmin has no PHP and no separate web server, so this directive
    takes its place. The module exports a function (``default`` or
    ``signonPage``) that receives the request and a context with the current
    ``SignonSession`` data (``session``), ``sessionCookie(data)`` (the
    ``Set-Cookie`` value that stores the credentials, ``null`` clears them) and
    ``returnTo`` (the page the user asked for), and returns a ``Response``. An
    external :config:option:`$cfg['Servers'][$i]['SignonURL']` keeps working
    without it.

    .. code-block:: json

        {
          "Servers": [{
            "auth_type": "signon",
            "SignonSession": "SignonSession",
            "SignonURL": "/signon/",
            "LogoutURL": "/signon/?logout",
            "SignonPage": "./apps/server/examples/signon-page.mjs"
          }]
        }

    .. seealso:: :ref:`auth_signon`, :ref:`example-signon`

.. config:option:: $cfg['Servers'][$i]['LogoutURL']

    :type: string
    :default: ``''``

    :term:`URL` where user will be redirected
    after logout (doesn't affect config authentication method). Should be
    absolute including protocol.

.. config:option:: $cfg['Servers'][$i]['hide_connection_errors']

    :type: boolean
    :default: false

    .. versionadded:: 4.9.8

    Whether to show or hide detailed MySQL/MariaDB connection errors on the login page.

    .. note::

        This error message can contain the target database server hostname or IP address,
        which may reveal information about your network to an attacker.

.. config:option:: $cfg['Servers'][$i]['max_connections']

    :type: integer
    :default: 4

    BetterMyAdmin only. The largest number of MySQL connections kept open for
    one session on this server. phpMyAdmin opens a new connection for every
    request; BetterMyAdmin keeps connections in a pool and reuses them (see
    :config:option:`$cfg['ConnectionPool']`).

Generic settings
----------------

.. config:option:: $cfg['DisableShortcutKeys']

    :type: boolean
    :default: false

    You can disable BetterMyAdmin shortcut keys by setting :config:option:`$cfg['DisableShortcutKeys']` to true.

.. config:option:: $cfg['ServerDefault']

    :type: integer
    :default: 1

    If you have more than one server configured, you can set
    :config:option:`$cfg['ServerDefault']` to any one of them to autoconnect to that
    server when BetterMyAdmin is started, or set it to 0 to be given a list
    of servers without logging in.

    If you have only one server configured,
    :config:option:`$cfg['ServerDefault']` MUST be set to that server.

.. config:option:: $cfg['VersionCheck']

    :type: boolean
    :default: true

    Enables check for latest versions using JavaScript on the main BetterMyAdmin
    page. BetterMyAdmin checks its own release feed (phpMyAdmin checks
    phpmyadmin.net); this and the error reports
    (:config:option:`$cfg['SendErrorReports']`) are the only outbound network
    calls it makes.

.. config:option:: $cfg['ProxyUrl']

    :type: string
    :default: ``''``

    The url of the proxy to be used when BetterMyAdmin needs to access the outside
    internet such as when retrieving the latest version info or submitting error
    reports. You need this if the server where BetterMyAdmin is installed does not
    have direct access to the internet.
    The format is: "hostname:portnumber"

.. config:option:: $cfg['ProxyUser']

    :type: string
    :default: ``''``

    The username for authenticating with the proxy. By default, no
    authentication is performed. If a username is supplied, Basic
    Authentication will be performed. No other types of authentication
    are currently supported.

.. config:option:: $cfg['ProxyPass']

    :type: string
    :default: ``''``

    The password for authenticating with the proxy.

.. config:option:: $cfg['MaxDbList']

    :type: integer
    :default: 100

    The maximum number of database names to be displayed in the main panel's
    database list.

.. config:option:: $cfg['MaxTableList']

    :type: integer
    :default: 250

    The maximum number of table names to be displayed in the main panel's
    list (except on the Export page).

.. config:option:: $cfg['MaxRoutineList']

    :type: integer
    :default: 250

    The maximum number of routine names to be displayed in the main panel's
    routine list.

.. config:option:: $cfg['ShowHint']

    :type: boolean
    :default: true

    Whether or not to show hints (for example, hints when hovering over
    table headers).

.. config:option:: $cfg['MaxCharactersInDisplayedSQL']

    :type: integer
    :default: 1000

    The maximum number of characters when a :term:`SQL` query is displayed. The
    default limit of 1000 should be correct to avoid the display of tons of
    hexadecimal codes that represent BLOBs, but some users have real
    :term:`SQL` queries that are longer than 1000 characters. Also, if a
    query's length exceeds this limit, this query is not saved in the history.

.. config:option:: $cfg['PersistentConnections']

    :type: boolean
    :default: false

    In phpMyAdmin, whether PHP's persistent MySQL connections should be used or
    not.

    .. note::

        This directive has no effect in BetterMyAdmin: it is a PHP feature.
        BetterMyAdmin always keeps MySQL connections in a pool and reuses them
        between requests (see :config:option:`$cfg['ConnectionPool']` and
        :config:option:`$cfg['Servers'][$i]['max_connections']`). The directive
        is accepted in the configuration but no settings form lists it.

.. config:option:: $cfg['ForceSSL']

    :type: boolean
    :default: false

    .. deprecated:: 4.6.0

        This setting is no longer available since phpMyAdmin 4.6.0, which
        asks you to adjust your web server instead. BetterMyAdmin honours it.

    Whether to force using https while accessing BetterMyAdmin. When ``true``,
    plain HTTP requests are redirected to HTTPS, a
    ``Strict-Transport-Security`` (HSTS) header is sent and the cookies are
    marked ``Secure``.

    .. note::

        Behind a TLS-terminating reverse proxy or load balancer, the proxy must
        send an ``X-Forwarded-Proto: https`` header so that BetterMyAdmin sees
        that the original request used HTTPS, and you might have to set
        :config:option:`$cfg['PmaAbsoluteUri']` for correct redirection.

.. config:option:: $cfg['MysqlSslWarningSafeHosts']

    :type: array [list of non-empty strings]
    :default: ``['127.0.0.1', 'localhost']``

    .. versionadded:: 5.1.0

    This search is case-sensitive and will match the exact string only.
    If your setup does not use SSL but is safe because you are using a
    local connection or private network, you can add your hostname or :term:`IP` to the list.
    You can also remove the default entries to only include yours.

    This check uses the value of :config:option:`$cfg['Servers'][$i]['host']`.

    Example configuration:

    .. code-block:: json

        { "MysqlSslWarningSafeHosts": ["127.0.0.1", "::1", "mariadb.local"] }

.. config:option:: $cfg['ExecTimeLimit']

    :type: integer [number of seconds]
    :default: 300

    Set the number of seconds an import is allowed to run. If seconds is
    set to zero, no time limit is imposed. With "Allow interruption"
    (the ``allow_interrupt`` key of :config:option:`$cfg['Import']`) the import stops a
    few seconds before the limit and can be resumed, as in phpMyAdmin. The
    Docker variable ``MAX_EXECUTION_TIME`` sets it.

    .. note::

        In phpMyAdmin this is PHP's time limit, which ends any request,
        exports included. BetterMyAdmin applies it to imports only: other
        requests, exports included, have no time limit and stream their
        output.

.. config:option:: $cfg['SessionSavePath']

    :type: string
    :default: ``''``

    In phpMyAdmin, the path for storing PHP session data (the
    ``session.save_path`` PHP parameter).

    .. note::

        This directive has no effect in BetterMyAdmin, which has no PHP
        sessions: sessions are kept in :file:`sessions.sqlite` in
        :config:option:`$cfg['DataDir']`. Keep that directory private.

.. config:option:: $cfg['MemoryLimit']

    :type: string [number of bytes]
    :default: ``'-1'``

    In phpMyAdmin, the number of bytes a PHP script is allowed to allocate
    (``'-1'``: no limit). You can use a string with a suffix, eg. ``'16M'``.
    Ensure you don't omit the suffix (16 means 16 bytes!) The Docker variable
    ``MEMORY_LIMIT`` sets it.

    .. note::

        BetterMyAdmin has no per-request memory limit: it uses this value only
        to size the chunks an import reads (an eighth of it), as phpMyAdmin
        does. Exports and other requests stream in bounded memory.

.. config:option:: $cfg['SkipLockedTables']

    :type: boolean
    :default: false

    Mark used tables and make it possible to show databases with locked
    tables (since MySQL 3.23.30).

.. config:option:: $cfg['ShowSQL']

    :type: boolean
    :default: true

    Defines whether :term:`SQL` queries
    generated by BetterMyAdmin should be displayed or not.

.. config:option:: $cfg['RetainQueryBox']

    :type: boolean
    :default: false

    Defines whether the :term:`SQL` query box
    should be kept displayed after its submission.

.. config:option:: $cfg['CodemirrorEnable']

    :type: boolean
    :default: true

    Defines whether to use a Javascript code editor for SQL query boxes.
    CodeMirror provides syntax highlighting and line numbers. However,
    middle-clicking for pasting the clipboard contents in some Linux
    distributions (such as Ubuntu) is not supported by all browsers.

.. config:option:: $cfg['LintEnable']

    :type: boolean
    :default: true

    .. versionadded:: 4.5.0

    Defines whether to use the parser to find any errors in the query before executing.

.. config:option:: $cfg['DefaultForeignKeyChecks']

    :type: string
    :default: ``'default'``

    Default value of the checkbox for foreign key checks, to disable/enable
    foreign key checks for certain queries. The possible values are ``'default'``,
    ``'enable'`` or ``'disable'``. If set to ``'default'``, the value of the
    MySQL variable ``FOREIGN_KEY_CHECKS`` is used.

.. config:option:: $cfg['AllowUserDropDatabase']

    :type: boolean
    :default: false

    .. warning::

        This is not a security measure as there will be always ways to
        circumvent this. If you want to prohibit users from dropping databases,
        revoke their corresponding DROP privilege.

    Defines whether normal users (non-administrator) are allowed to delete
    their own database or not. If set as false, the link :guilabel:`Drop
    Database` will not be shown, and even a ``DROP DATABASE mydatabase`` will
    be rejected. Quite practical for :term:`ISP` 's with many customers.

    This limitation of :term:`SQL` queries is not as strict as when using MySQL
    privileges. This is due to nature of :term:`SQL` queries which might be
    quite complicated. So this choice should be viewed as help to avoid
    accidental dropping rather than strict privilege limitation.

.. config:option:: $cfg['Confirm']

    :type: boolean
    :default: true

    Whether a warning ("Are your really sure...") should be displayed when
    you're about to lose data.

.. config:option:: $cfg['UseDbSearch']

    :type: boolean
    :default: true

    Define whether the "search string inside database" is enabled or not.

.. config:option:: $cfg['IgnoreMultiSubmitErrors']

    :type: boolean
    :default: false

    Define whether BetterMyAdmin will continue executing a multi-query
    statement if one of the queries fails. Default is to abort execution.

.. config:option:: $cfg['enable_drag_drop_import']

    :type: boolean
    :default: true

    Whether or not the drag and drop import feature is enabled.
    When enabled, a user can drag a file in to their browser and BetterMyAdmin will
    attempt to import the file.

.. config:option:: $cfg['URLQueryEncryption']

    :type: boolean
    :default: false

    .. versionadded:: 4.9.8

    Define whether BetterMyAdmin will encrypt sensitive data (like database name
    and table name) from the URL query string. Default is to not encrypt the URL
    query string.

.. config:option:: $cfg['URLQueryEncryptionSecretKey']

    :type: string
    :default: ``''``

    .. versionadded:: 4.9.8

    A secret key used to encrypt/decrypt the URL query string.
    Should be 32 bytes long.

    .. seealso:: :ref:`faq2_10`

.. config:option:: $cfg['maxRowPlotLimit']

    :type: integer
    :default: 500

    Maximum number of rows retrieved for zoom search.

Cookie authentication options
-----------------------------

.. config:option:: $cfg['blowfish_secret']

    :type: string
    :default: ``''``

    The secret from which BetterMyAdmin derives its encryption keys (with
    HKDF-SHA256, for AES-256-GCM). It encrypts the credentials that the
    ``'cookie'``, ``'http'`` and ``'signon'``
    :config:option:`$cfg['Servers'][$i]['auth_type']` keep in the server-side
    session, the recalled user name (:config:option:`$cfg['LoginCookieRecall']`)
    and the signon hand-off cookie, and it signs the SQL queries carried in
    URLs. You won't be prompted for this key. Enter a random string of at
    least 32 characters, for example:

    .. code-block:: json

        { "blowfish_secret": "JOFw435365IScA&Q!cDugr!lSfuAz*OW" }

    If it is empty, BetterMyAdmin generates one on the first start (32 random
    bytes) and keeps it in the file :file:`secret` in
    :config:option:`$cfg['DataDir']` (mode ``0600``), so it survives restarts;
    the home page then still suggests configuring one.

    .. note::

        phpMyAdmin encrypts the password into the browser cookie with the
        PHP sodium functions, and its configuration often writes the secret as
        ``sodium_hex2bin('…')``. BetterMyAdmin keeps only a session id in the
        cookie (the credentials stay on the server), and a configuration file
        holds data, not PHP calls: write the secret as a plain string (the
        setup script's :file:`bettermyadmin.config.json` keeps a
        ``sodium_hex2bin`` secret as its 64-digit hexadecimal string).

    .. warning::

        The home page warns when the key is shorter than 32 bytes. A longer key
        is fine (phpMyAdmin wants exactly 32 bytes because it uses the secret
        itself as the key; BetterMyAdmin derives its keys from it), so the
        generated secret and a converted phpMyAdmin hex secret need no change.

    .. note::

        The configuration is called blowfish_secret for historical reasons as
        Blowfish algorithm was originally used to do the encryption.

    .. seealso:: :ref:`faq2_10`

.. config:option:: $cfg['CookieSameSite']

    :type: string
    :default: ``'Strict'``

    .. versionadded:: 5.1.0

    It sets SameSite attribute of the Set-Cookie :term:`HTTP` response header.
    Valid values are:

    * ``Lax``
    * ``Strict``
    * ``None``

    .. seealso:: `rfc6265 bis <https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-03#section-5.3.7>`_

.. config:option:: $cfg['LoginCookieRecall']

    :type: boolean
    :default: true

    Define whether the previous login should be recalled or not in cookie
    authentication mode.

    This is automatically disabled if you do not have
    configured :config:option:`$cfg['blowfish_secret']`.

.. config:option:: $cfg['LoginCookieValidity']

    :type: integer [number of seconds]
    :default: 1440

    Define how long a login is valid without activity: a session idle for
    longer is logged out. (phpMyAdmin additionally depends on PHP's
    ``session.gc_maxlifetime``; BetterMyAdmin has no such setting.)

.. config:option:: $cfg['LoginCookieStore']

    :type: integer [number of seconds]
    :default: 0

    Define how long login cookie should be stored in browser. Default 0
    means that it will be kept for existing session. This is recommended
    for not trusted environments.

.. config:option:: $cfg['LoginCookieDeleteAll']

    :type: boolean
    :default: true

    If enabled (default), logout deletes cookies for all servers,
    otherwise only for current one. Setting this to false makes it easy to
    forget to log out from other server, when you are using more of them.

.. _AllowArbitraryServer:
.. config:option:: $cfg['AllowArbitraryServer']

    :type: boolean
    :default: false

    If enabled, allows you to log in to arbitrary servers using cookie
    authentication.

    .. note::

        Please use this carefully, as this may allow users access to MySQL servers
        behind the firewall where BetterMyAdmin is placed.
        See also :config:option:`$cfg['ArbitraryServerRegexp']`.

.. config:option:: $cfg['ArbitraryServerRegexp']

    :type: string
    :default: ``''``

    Restricts the MySQL servers to which the user can log in when
    :config:option:`$cfg['AllowArbitraryServer']` is enabled by
    matching the :term:`IP` or the hostname of the MySQL server
    to the given regular expression. The regular expression must be enclosed
    with a delimiter character and may be followed by modifiers, as in
    phpMyAdmin (PCRE syntax): BetterMyAdmin converts it, so a pattern written
    for phpMyAdmin works unchanged.

    It is recommended to include start and end symbols in the regular
    expression, so that you can avoid partial matches on the string.

    **Examples:**

    Allow connection to three listed servers:

    .. code-block:: json

        { "ArbitraryServerRegexp": "/^(server|another|yetdifferent)$/" }

    Allow connection to range of IP addresses (in JSON, a backslash is
    written twice):

    .. code-block:: json

        { "ArbitraryServerRegexp": "@^192\\.168\\.0\\.[0-9]{1,}$@" }

    Allow connection to server name ending with -mysql:

    .. code-block:: json

        { "ArbitraryServerRegexp": "@^[^:]\\-mysql$@" }

    .. note::

        The whole server name is matched, it can include port as well. Due to
        way MySQL is permissive in connection parameters, it is possible to use
        connection strings as ```server:3306-mysql```. This can be used to
        bypass regular expression by the suffix, while connecting to another
        server.

.. config:option:: $cfg['CaptchaMethod']

    :type: string
    :default: ``'invisible'``

    Valid values are:

    * ``'invisible'`` Use an invisible captcha checking method;
    * ``'checkbox'`` Use a checkbox to confirm the user is not a robot.

    .. versionadded:: 5.0.3

.. config:option:: $cfg['CaptchaApi']

    :type: string
    :default: ``'https://www.google.com/recaptcha/api.js'``

    .. versionadded:: 5.1.0

    The URL for the reCaptcha v2 service's API, either Google's or a compatible one.

.. config:option:: $cfg['CaptchaCsp']

    :type: string
    :default: ``'https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://ssl.gstatic.com/'``

    .. versionadded:: 5.1.0

    The Content-Security-Policy snippet (URLs from which to allow embedded content)
    for the reCaptcha v2 service, either Google's or a compatible one.

.. config:option:: $cfg['CaptchaRequestParam']

    :type: string
    :default: ``'g-recaptcha'``

    .. versionadded:: 5.1.0

    The request parameter used for the reCaptcha v2 service.

.. config:option:: $cfg['CaptchaResponseParam']

    :type: string
    :default: ``'g-recaptcha-response'``

    .. versionadded:: 5.1.0

    The response parameter used for the reCaptcha v2 service.

.. config:option:: $cfg['CaptchaLoginPublicKey']

    :type: string
    :default: ``''``

    The public key for the reCaptcha service that can be obtained from the
    "Admin Console" on https://www.google.com/recaptcha/about/.

    .. seealso:: <https://developers.google.com/recaptcha/docs/v3>

    reCaptcha will be then used in :ref:`cookie`.

    .. versionadded:: 4.1.0

.. config:option:: $cfg['CaptchaLoginPrivateKey']

    :type: string
    :default: ``''``

    The private key for the reCaptcha service that can be obtained from the
    "Admin Console" on https://www.google.com/recaptcha/about/.

    .. seealso:: <https://developers.google.com/recaptcha/docs/v3>

    reCaptcha will be then used in :ref:`cookie`.

    .. versionadded:: 4.1.0

.. config:option:: $cfg['CaptchaSiteVerifyURL']

    :type: string
    :default: ``''``

    The URL for the reCaptcha service to do siteverify action.

    reCaptcha will be then used in :ref:`cookie`.

    .. versionadded:: 5.1.0

Navigation panel setup
----------------------

.. config:option:: $cfg['ShowDatabasesNavigationAsTree']

    :type: boolean
    :default: true

    Defines whether to display databases in the navigation panel as a tree
    instead of in a dropdown selector.

.. config:option:: $cfg['FirstLevelNavigationItems']

    :type: integer
    :default: 100

    The number of first level databases that can be displayed on each page
    of navigation tree.

.. config:option:: $cfg['MaxNavigationItems']

    :type: integer
    :default: 50

    The number of items (tables, columns, indexes) that can be displayed on each
    page of the navigation tree.

.. config:option:: $cfg['NavigationTreeEnableGrouping']

    :type: boolean
    :default: true

    Defines whether to group the databases based on a common prefix
    in their name :config:option:`$cfg['NavigationTreeDbSeparator']`.

.. config:option:: $cfg['NavigationTreeDbSeparator']

    :type: string
    :default: ``'_'``

    The string used to separate the parts of the database name when
    showing them in a tree.

.. config:option:: $cfg['NavigationTreeTableSeparator']

    :type: string or array
    :default: ``'__'``

    Defines a string to be used to nest table spaces. This means if you have
    tables like ``first__second__third`` this will be shown as a three-level
    hierarchy like: first > second > third. If set to false or empty, the
    feature is disabled. NOTE: You should not use this separator at the
    beginning or end of a table name or multiple times after another without
    any other characters in between.

.. config:option:: $cfg['NavigationTreeTableLevel']

    :type: integer
    :default: 1

    Defines how many sublevels should be displayed when splitting up
    tables by the above separator.

.. config:option:: $cfg['NumRecentTables']

    :type: integer
    :default: 10

    The maximum number of recently used tables shown in the navigation
    panel. Set this to 0 (zero) to disable the listing of recent tables.

.. config:option:: $cfg['NumFavoriteTables']

    :type: integer
    :default: 10

    The maximum number of favorite tables shown in the navigation
    panel. Set this to 0 (zero) to disable the listing of favorite tables.

.. config:option:: $cfg['ZeroConf']

    :type: boolean
    :default: true

    Enables Zero Configuration mode in which the user will be offered a choice to
    create phpMyAdmin configuration storage in the current database
    or use the existing one, if already present.

    This setting has no effect if the phpMyAdmin configuration storage database
    is properly created and the related configuration directives (such as
    :config:option:`$cfg['Servers'][$i]['pmadb']` and so on) are configured.

.. config:option:: $cfg['NavigationLinkWithMainPanel']

    :type: boolean
    :default: true

    Defines whether or not to link with main panel by highlighting
    the current database or table.

.. config:option:: $cfg['NavigationDisplayLogo']

    :type: boolean
    :default: true

    Defines whether or not to display the BetterMyAdmin logo at the top of
    the navigation panel.

.. config:option:: $cfg['NavigationLogoLink']

    :type: string
    :default: ``'index.php'``

    Enter the :term:`URL` where the logo in the navigation panel will point to.
    The default ``'index.php'`` (phpMyAdmin's home page), like any other
    internal (relative) link, opens BetterMyAdmin's home page.
    For external URLs, you should include URL protocol schemes (``http`` or ``https``) with absolute URLs.

    You may want to make the link open in a new browser tab, for that you need to use :config:option:`$cfg['NavigationLogoLinkWindow']`

.. config:option:: $cfg['NavigationLogoLinkWindow']

    :type: string
    :default: ``'main'``

    Whether to open the linked page in the main window (``main``) or in a
    new one (``new``). Note: use ``new`` if you are linking to
    ``phpmyadmin.net``.

    To open the link in the main window you will need to add the value of :config:option:`$cfg['NavigationLogoLink']`
    to :config:option:`$cfg['CSPAllow']` because of the :term:`Content Security Policy` header.

.. config:option:: $cfg['NavigationTreeDisplayItemFilterMinimum']

    :type: integer
    :default: 30

    Defines the minimum number of items (tables, views, routines and
    events) to display a JavaScript filter box above the list of items in
    the navigation tree.

    To disable the filter completely some high number can be used (e.g. 9999)

.. config:option:: $cfg['NavigationTreeDisplayDbFilterMinimum']

    :type: integer
    :default: 30

    Defines the minimum number of databases to display a JavaScript filter
    box above the list of databases in the navigation tree.

    To disable the filter completely some high number can be used
    (e.g. 9999)

.. config:option:: $cfg['NavigationDisplayServers']

    :type: boolean
    :default: true

    Defines whether or not to display a server choice at the top of the
    navigation panel.

.. config:option:: $cfg['DisplayServersList']

    :type: boolean
    :default: false

    Defines whether to display this server choice as links instead of in a
    drop-down.

.. config:option:: $cfg['NavigationTreeDefaultTabTable']

    :type: string
    :default: ``'structure'``

    Defines the tab displayed by default when clicking the small icon next
    to each table name in the navigation panel. The possible values are:

    * ``structure``
    * ``sql``
    * ``search``
    * ``insert``
    * ``browse``

.. config:option:: $cfg['NavigationTreeDefaultTabTable2']

    :type: string
    :default: null

    Defines the tab displayed by default when clicking the second small icon next
    to each table name in the navigation panel. The possible values are:

    * ``(empty)``
    * ``structure``
    * ``sql``
    * ``search``
    * ``insert``
    * ``browse``

.. config:option:: $cfg['NavigationTreeEnableExpansion']

    :type: boolean
    :default: true

    Whether to offer the possibility of tree expansion in the navigation panel.

.. config:option:: $cfg['NavigationTreeShowTables']

    :type: boolean
    :default: true

    Whether to show tables under database in the navigation panel.

.. config:option:: $cfg['NavigationTreeShowViews']

    :type: boolean
    :default: true

    Whether to show views under database in the navigation panel.

.. config:option:: $cfg['NavigationTreeShowFunctions']

    :type: boolean
    :default: true

    Whether to show functions under database in the navigation panel.

.. config:option:: $cfg['NavigationTreeShowProcedures']

    :type: boolean
    :default: true

    Whether to show procedures under database in the navigation panel.

.. config:option:: $cfg['NavigationTreeShowEvents']

    :type: boolean
    :default: true

    Whether to show events under database in the navigation panel.

.. config:option:: $cfg['NavigationTreeAutoexpandSingleDb']

    :type: boolean
    :default: true

    Whether to expand single database in the navigation tree automatically.

.. config:option:: $cfg['NavigationWidth']

    :type: integer
    :default: 240

    Navigation panel width, set to 0 to collapse it by default.

Main panel
----------

.. config:option:: $cfg['ShowStats']

    :type: boolean
    :default: true

    Defines whether or not to display space usage and statistics about
    databases and tables.

.. config:option:: $cfg['ShowServerInfo']

    :type: boolean|string
    :default: true

    Defines whether to display detailed server information on main page.
    Possible values are:

    * ``true`` to show all server information
    * ``false`` to hide server information
    * ``'database-server'`` to show only database server information
    * ``'web-server'`` to show only web server information (in BetterMyAdmin,
      the Node.js server and runtime)

    You can additionally hide more information by using
    :config:option:`$cfg['Servers'][$i]['verbose']`.

    .. versionchanged:: 6.0.0
        Added ``'database-server'`` and ``'web-server'`` options.

.. config:option:: $cfg['ShowPhpInfo']

    :type: boolean
    :default: false

    Defines whether to display the :guilabel:`Show runtime information` link
    or not at the starting main (right) frame.

    In phpMyAdmin this links to PHP's ``phpinfo()`` page. BetterMyAdmin has no
    PHP: the link opens a "Runtime info" page instead (Node.js version,
    platform and a summary of the configuration).

    .. warning::

        Enabling this page will leak information about the server
        setup. Is it not recommended to enable this on shared installations.

        This might also make easier some remote attacks on your installations,
        so enable this only when needed.

.. config:option:: $cfg['ShowChgPassword']

    :type: boolean
    :default: true

    Defines whether to display the :guilabel:`Change password` link or not at
    the starting main (right) frame. This setting does not check MySQL commands
    entered directly.

    Please note that enabling the :guilabel:`Change password` link has no effect
    with config authentication mode: because of the hard coded password value
    in the configuration file, end users can't be allowed to change their
    passwords.

.. config:option:: $cfg['ShowCreateDb']

    :type: boolean
    :default: true

    Defines whether to display the form for creating database or not at the
    starting main (right) frame. This setting does not check MySQL commands
    entered directly.

.. config:option:: $cfg['ShowGitRevision']

    :type: boolean
    :default: true

    Defines whether to display information about the current Git revision (if
    applicable) on the main panel.

.. config:option:: $cfg['MysqlMinVersion']

    :type: array
    :default: ``{"internal": 50500, "human": "5.5.0"}``

    Defines the minimum supported MySQL version: ``internal`` is the version
    as a number, ``human`` as shown to the user. The default (5.5.0) is
    phpMyAdmin's; the directive was asked by a developer of the Plesk control
    panel to ease integration with older MySQL servers (where most of the
    features work).

Database structure
------------------

.. config:option:: $cfg['ShowDbStructureCharset']

    :type: boolean
    :default: false

    Defines whether to show a column displaying the charset for all tables in the database structure page.

.. config:option:: $cfg['ShowDbStructureComment']

    :type: boolean
    :default: false

    Defines whether to show a column displaying the comments for all tables in the database structure page.

.. config:option:: $cfg['ShowDbStructureCreation']

    :type: boolean
    :default: false

    Defines whether the database structure page (tables list) has a
    "Creation" column that displays when each table was created.

.. config:option:: $cfg['ShowDbStructureLastUpdate']

    :type: boolean
    :default: false

    Defines whether the database structure page (tables list) has a "Last
    update" column that displays when each table was last updated.

.. config:option:: $cfg['ShowDbStructureLastCheck']

    :type: boolean
    :default: false

    Defines whether the database structure page (tables list) has a "Last
    check" column that displays when each table was last checked.

.. config:option:: $cfg['HideStructureActions']

    :type: boolean
    :default: true

    Defines whether the table structure actions are hidden under a ":guilabel:`More`"
    drop-down.

.. config:option:: $cfg['ShowColumnComments']

    :type: boolean
    :default: true

    Defines whether to show column comments as a column in the table structure view.

Browse mode
-----------

.. config:option:: $cfg['TableNavigationLinksMode']

    :type: string
    :default: ``'icons'``

    Defines whether the table navigation links contain ``'icons'``, ``'text'``
    or ``'both'``.

.. config:option:: $cfg['ActionLinksMode']

    :type: string
    :default: ``'both'``

    If set to ``icons``, will display icons instead of text for db and table
    properties links (like :guilabel:`Browse`, :guilabel:`Select`,
    :guilabel:`Insert`, ...). Can be set to ``'both'``
    if you want icons AND text. When set to ``text``, will only show text.

.. config:option:: $cfg['RowActionType']

    :type: string
    :default: ``'both'``

    Whether to display icons or text or both icons and text in table row action
    segment. Value can be either of ``'icons'``, ``'text'`` or ``'both'``.

.. config:option:: $cfg['ShowAll']

    :type: boolean
    :default: false

    Defines whether a user should be displayed a ":guilabel:`Show all`" button in browse
    mode or not in all cases. By default it is shown only on small tables (less
    than 500 rows) to avoid performance issues while getting too many rows.

.. config:option:: $cfg['MaxRows']

    :type: integer
    :default: 25

    Number of rows displayed when browsing a result set and no LIMIT
    clause is used. If the result set contains more rows, ":guilabel:`Previous`" and
    ":guilabel:`Next`" links will be shown. Possible values: 25,50,100,250,500.

.. config:option:: $cfg['Order']

    :type: string
    :default: ``'SMART'``

    Defines whether columns are displayed in ascending (``ASC``) order, in
    descending (``DESC``) order or in a "smart" (``SMART``) order - I.E.
    descending order for columns of type TIME, DATE, DATETIME and
    TIMESTAMP, ascending order else- by default.

    .. versionchanged:: 3.4.0
        Since phpMyAdmin 3.4.0 the default value is ``'SMART'``.

.. config:option:: $cfg['DisplayBinaryAsHex']

    :type: boolean
    :default: true

    Defines whether the ":guilabel:`Show binary contents as HEX`" browse option is
    ticked by default.

    .. versionadded:: 3.3.0
    .. deprecated:: 4.3.0

        This setting was removed.

.. config:option:: $cfg['GridEditing']

    :type: string
    :default: ``'double-click'``

    Defines which action (``double-click`` or ``click``) triggers grid
    editing. Can be deactivated with the ``disabled`` value.

.. config:option:: $cfg['RelationalDisplay']

    :type: string
    :default: ``'K'``

    Defines the initial behavior for Options > Relational. ``K``, which
    is the default, displays the key while ``D`` shows the display column.

.. config:option:: $cfg['SaveCellsAtOnce']

    :type: boolean
    :default: false

    Defines whether or not to save all edited cells at once for grid
    editing.

Editing mode
------------

.. config:option:: $cfg['ProtectBinary']

    :type: boolean or string
    :default: ``'blob'``

    Defines whether ``BLOB`` or ``BINARY`` columns are protected from
    editing when browsing a table's content. Valid values are:

    * ``false`` to allow editing of all columns;
    * ``'blob'`` to allow editing of all columns except ``BLOBS``;
    * ``'noblob'`` to disallow editing of all columns except ``BLOBS`` (the
      opposite of ``'blob'``);
    * ``'all'`` to disallow editing of all ``BINARY`` or ``BLOB`` columns.

.. config:option:: $cfg['ShowFunctionFields']

    :type: boolean
    :default: true

    Defines whether or not MySQL functions fields should be initially
    displayed in edit/insert mode. Since version 2.10, the user can toggle
    this setting from the interface.

.. config:option:: $cfg['ShowFieldTypesInDataEditView']

    :type: boolean
    :default: true

    Defines whether or not type fields should be initially displayed in
    edit/insert mode. The user can toggle this setting from the interface.

.. config:option:: $cfg['InsertRows']

    :type: integer
    :default: 2

    Defines the default number of rows to be entered from the Insert page.
    Users can manually change this from the bottom of that page to add or remove
    blank rows.

.. config:option:: $cfg['ForeignKeyMaxLimit']

    :type: integer
    :default: 100

    If there are fewer items than this in the set of foreign keys, then a
    drop-down box of foreign keys is presented, in the style described by
    the :config:option:`$cfg['ForeignKeyDropdownOrder']` setting.

.. config:option:: $cfg['ForeignKeyDropdownOrder']

    :type: array
    :default: ``['content-id', 'id-content']``

    For the foreign key drop-down fields, there are several methods of
    display, offering both the key and value data. The contents of the
    array should be one or both of the following strings: ``content-id``,
    ``id-content``.

Export and import settings
--------------------------

.. config:option:: $cfg['ZipDump']

    :type: boolean
    :default: true

.. config:option:: $cfg['GZipDump']

    :type: boolean
    :default: true

.. config:option:: $cfg['BZipDump']

    :type: boolean
    :default: true

    Defines whether to allow the use of zip/GZip/BZip2 compression when
    creating a dump file

.. config:option:: $cfg['CompressOnFly']

    :type: boolean
    :default: true

    Defines whether to allow on the fly compression for GZip
    compressed exports: the output is compressed in chunks, so produced files
    contain more GZip headers, but all normal programs handle this correctly.

    .. note::

        In phpMyAdmin this lets larger dumps fit in PHP's memory limit.
        BetterMyAdmin always streams exports, compressed or not, so memory is
        not a concern either way.

.. config:option:: $cfg['Export']

    :type: array
    :default: ``[...]``

    In this array are defined default parameters for export, names of
    items are similar to texts seen on export page, so you can easily
    identify what they mean.

.. config:option:: $cfg['Export']['format']

    :type: string
    :default: ``'sql'``

    Default export format. Besides phpMyAdmin's formats, ``'jsmodule'``
    selects BetterMyAdmin's "JavaScript module" format, which replaces
    phpMyAdmin's "PHP array" (``'phparray'`` is accepted and falls back to
    ``'sql'``).

.. config:option:: $cfg['Export']['method']

    :type: string
    :default: ``'quick'``

    Defines how the export form is displayed when it loads. Valid values
    are:

    * ``quick`` to display the minimum number of options to configure
    * ``custom`` to display every available option to configure
    * ``custom-no-form`` same as ``custom`` but does not display the option
      of using quick export

.. config:option:: $cfg['Export']['compression']

    :type: string
    :default: ``'none'``

    Default export compression method. Possible values are ``'none'``, ``'zip'`` or ``'gzip'``.

.. config:option:: $cfg['Export']['charset']

    :type: string
    :default: ``''``

    Defines charset for generated export. By default no charset conversion is
    done assuming UTF-8.

.. config:option:: $cfg['Export']['file_template_table']

    :type: string
    :default: ``'@TABLE@'``

    Default filename template for table exports.

    .. seealso:: :ref:`faq6_27`

.. config:option:: $cfg['Export']['file_template_database']

    :type: string
    :default: ``'@DATABASE@'``

    Default filename template for database exports.

    .. seealso:: :ref:`faq6_27`

.. config:option:: $cfg['Export']['file_template_server']

    :type: string
    :default: ``'@SERVER@'``

    Default filename template for server exports.

    .. seealso:: :ref:`faq6_27`

.. config:option:: $cfg['Export']['remove_definer_from_definitions']

    :type: boolean
    :default: false

    Remove DEFINER clause from the event, view and routine definitions.

    .. versionadded:: 5.2.0

.. config:option:: $cfg['Export']['csv_escape_formulas']

    :type: boolean
    :default: false

    BetterMyAdmin only. When enabled, :term:`CSV` and CSV for MS Excel cells
    starting with ``=``, ``+``, ``-`` or ``@`` are escaped, so that a
    spreadsheet does not run them as formulas (CSV injection). It is off by
    default to produce the same files as phpMyAdmin, which never escapes
    them.

.. config:option:: $cfg['Export']['jsmodule_structure_or_data']

    :type: string
    :default: ``'data'``

    BetterMyAdmin only. What the "JavaScript module" export contains by
    default: ``'structure'``, ``'data'`` or ``'structure_and_data'``. This
    format takes the place of phpMyAdmin's "PHP array" export (whose
    ``phparray_structure_or_data`` is accepted and has no use): each table
    becomes ``export const <table> = [{…}]`` in a ``.js`` file, values as JSON
    strings and binary or geometry values in hexadecimal.

.. config:option:: $cfg['Import']

    :type: array
    :default: ``[...]``

    In this array are defined default parameters for import, names of
    items are similar to texts seen on import page, so you can easily
    identify what they mean.

.. config:option:: $cfg['Import']['charset']

    :type: string
    :default: ``''``

    Defines charset for import. By default no charset conversion is done
    assuming UTF-8.

.. config:option:: $cfg['Import']['MaxDecompressedSize']

    :type: integer [number of bytes]
    :default: 0

    BetterMyAdmin only. The largest size a compressed import file (gzip,
    bzip2, zip) may decompress to; a larger output stops the import, which
    protects against "zip bombs". ``0`` means ten times
    :config:option:`$cfg['MaxUploadSize']`.

.. config:option:: $cfg['Schema']

    :type: array
    :default: ``[...]``

.. config:option:: $cfg['Schema']['format']

    :type: string
    :default: ``'pdf'``

    Defines the default format for schema export. Possible values are ``'pdf'``, ``'eps'``, ``'dia'`` or ``'svg'``.

    The PDF schema needs no :term:`TCPDF`: BetterMyAdmin draws the same
    document itself, with the DejaVu Sans font embedded.

Tabs display settings
---------------------

.. config:option:: $cfg['TabsMode']

    :type: string
    :default: ``'both'``

    Defines whether the menu tabs contain ``'icons'``, ``'text'`` or ``'both'``.

.. config:option:: $cfg['PropertiesNumColumns']

    :type: integer
    :default: 1

    How many columns will be utilized to display the tables on the database
    property view? When setting this to a value larger than 1, the type of the
    database will be omitted for more display space.

.. config:option:: $cfg['DefaultTabServer']

    :type: string
    :default: ``'welcome'``

    Defines the tab displayed by default on server view. The possible values
    are:

    * ``welcome`` (recommended for multi-user setups)
    * ``databases``,
    * ``status``
    * ``variables``
    * ``privileges``

.. config:option:: $cfg['DefaultTabDatabase']

    :type: string
    :default: ``'structure'``

    Defines the tab displayed by default on database view. The possible values
    are:

    * ``structure``
    * ``sql``
    * ``search``
    * ``operations``

.. config:option:: $cfg['DefaultTabTable']

    :type: string
    :default: ``'browse'``

    Defines the tab displayed by default on table view. The possible values
    are:

    * ``structure``
    * ``sql``
    * ``search``
    * ``insert``
    * ``browse``

PDF Options
-----------

.. config:option:: $cfg['PDFPageSizes']

    :type: array
    :default: ``['A3', 'A4', 'A5', 'letter', 'legal']``

    Array of possible paper sizes for creating PDF pages.

    You should never need to change this.

.. config:option:: $cfg['PDFDefaultPageSize']

    :type: string
    :default: ``'A4'``

    Default page size to use when creating PDF pages. Valid values are any
    listed in :config:option:`$cfg['PDFPageSizes']`.

Languages
---------

.. config:option:: $cfg['DefaultLang']

    :type: string
    :default: ``'en'``

    Defines the default language to use, if not browser-defined or user-
    defined. It must be one of the languages BetterMyAdmin ships (phpMyAdmin's
    translations, built into the application).

.. config:option:: $cfg['DefaultConnectionCollation']

    :type: string
    :default: ``'utf8mb4_general_ci'``

    Defines the default connection collation to use, if not user-defined.
    See the `MySQL documentation for charsets
    <https://dev.mysql.com/doc/refman/5.7/en/charset-charsets.html>`_
    for list of possible values.

.. config:option:: $cfg['Lang']

    :type: string
    :default: not set

    Force language to use. It must be one of the languages BetterMyAdmin
    ships.

.. config:option:: $cfg['FilterLanguages']

    :type: string
    :default: ``''``

    Limit list of available languages to those matching the given regular
    expression. For example if you want only Czech and English, you should
    set filter to ``'^(cs|en)'``.

.. config:option:: $cfg['RecodingEngine']

    :type: string
    :default: ``'auto'``

    You can select here which functions will be used for character set
    conversion. Possible values are:

    * ``'auto'`` - automatically use available one (first is tested ``iconv``, then ``mbstring``)
    * ``'iconv'`` - use iconv or ``libiconv`` functions
    * ``'mb'`` - use :term:`mbstring` extension
    * ``'none'`` - disable encoding conversion

    BetterMyAdmin has no PHP extensions: every value converts with the same
    built-in converter, which follows iconv's behaviour (including
    :config:option:`$cfg['IconvExtraParams']`). As in phpMyAdmin, ``'none'``
    still converts. A character that cannot be converted ends the export or
    import with an error message (phpMyAdmin stops with a PHP error).

    Enabled charset conversion activates a pull-down menu in the Export
    and Import pages, to choose the character set when exporting a file.
    The default value in this menu comes from
    :config:option:`$cfg['Export']['charset']` and :config:option:`$cfg['Import']['charset']`.

    .. versionchanged:: 6.0.0

        Support for the Recode extension has been removed. The ``'recode'`` value is ignored and the
        default value (``'auto'``) is used instead.

.. config:option:: $cfg['IconvExtraParams']

    :type: string
    :default: ``'//TRANSLIT'``

    Specify some parameters for iconv used in charset conversion. See
    `iconv documentation <https://www.gnu.org/savannah-checkouts/gnu/libiconv/documentati
    on/libiconv-1.15/iconv_open.3.html>`_ for details. By default
    ``//TRANSLIT`` is used, so that invalid characters will be
    transliterated.

.. config:option:: $cfg['AvailableCharsets']

    :type: array [list of strings]
    :default: ``[...]``

    Available character sets for MySQL conversion. You can add your own
    (any of supported by iconv) or remove these which you don't
    use. Character sets will be shown in same order as here listed, so if
    you frequently use some of these move them to the top.

    Example configuration:

    .. code-block:: json

        { "AvailableCharsets": ["utf-8", "iso-8859-1"] }

Web server settings
-------------------

These settings concern the HTTP server built into BetterMyAdmin; there is no
separate web server to configure.

.. config:option:: $cfg['OBGzip']

    :type: string/boolean
    :default: ``'auto'``

    Defines whether to use GZip output buffering for increased speed in
    :term:`HTTP` transfers. Set to
    true/false for enabling/disabling. When set to 'auto' (string),
    BetterMyAdmin tries to enable output buffering and will automatically
    disable it if your browser has some problems with buffering. IE6 with
    a certain patch is known to cause data corruption when having enabled
    buffering.

    .. deprecated:: 6.0.0

        This setting was removed.

.. config:option:: $cfg['TrustedProxies']

    :type: array
    :default: ``[]``

    Lists proxies and HTTP headers which are trusted for
    :config:option:`$cfg['Servers'][$i]['AllowDeny']['order']`. This list is by
    default empty, you need to fill in some trusted proxy servers if you
    want to use rules for IP addresses behind proxy.

    The following example specifies that BetterMyAdmin should trust a
    ``HTTP_X_FORWARDED_FOR`` (``X-Forwarded-For``) header coming from the proxy
    1.2.3.4:

    .. code-block:: json

        { "TrustedProxies": { "1.2.3.4": "HTTP_X_FORWARDED_FOR" } }

    The :config:option:`$cfg['Servers'][$i]['AllowDeny']['rules']` directive uses the
    client's IP address as usual.

.. config:option:: $cfg['GD2Available']

    :type: string
    :default: ``'auto'``

    Specifies whether GD >= 2 is available. If yes it can be used for MIME
    transformations. Possible values are:

    * ``auto`` - automatically detect
    * ``yes`` - GD 2 functions can be used
    * ``no`` - GD 2 function cannot be used

    BetterMyAdmin does not use the PHP GD extension: thumbnails are resized by
    built-in code that reproduces GD's resampling, so ``auto`` and ``yes``
    both mean available. With ``no``, the inline image transformations show
    the original image instead of a resized thumbnail.

.. config:option:: $cfg['CheckConfigurationPermissions']

    :type: boolean
    :default: true

    We normally check the permissions on the configuration file to ensure
    it's not world writable: a world-writable file stops every request with an
    error. However, the configuration file could be on a
    NTFS filesystem mounted on a non-Windows server, in which case the
    permissions seems wrong but in fact cannot be detected. In this case a
    sysadmin would set this parameter to ``false``.

.. config:option:: $cfg['LinkLengthLimit']

    :type: integer
    :default: 1000

    Limit for length of :term:`URL` in links. When length would be above this
    limit, it is replaced by form with button. This is required as some web
    servers (:term:`IIS`) have problems with long :term:`URL`.

    .. note::

        This directive has no effect in BetterMyAdmin, whose pages keep their
        parameters in the path and in request bodies rather than in long
        URLs.

.. config:option:: $cfg['CSPAllow']

    :type: string
    :default: ``''``

    Additional string to include in allowed script and image sources in Content
    Security Policy header.

    This can be useful when you want to load some external resources (for
    example a logo link target, see
    :config:option:`$cfg['NavigationLogoLinkWindow']`), which would be normally
    not allowed by :term:`Content Security Policy`.

    To allow some sites, just list them within the string:

    .. code-block:: json

        { "CSPAllow": "example.com example.net" }

    .. versionadded:: 4.0.4

.. config:option:: $cfg['DisableMultiTableMaintenance']

    :type: boolean
    :default: false

    In the database Structure page, it's possible to mark some tables then
    choose an operation like optimizing for many tables. This can slow
    down a server; therefore, setting this to ``true`` prevents this kind
    of multiple maintenance operation.

Theme settings
--------------

BetterMyAdmin's themes are sets of design tokens built into the application,
not theme folders with SCSS files: there is nothing to edit on the server. See
:ref:`themes` and :config:option:`$cfg['ThemeDefault']`.

Design customization
--------------------

.. config:option:: $cfg['NavigationTreePointerEnable']

    :type: boolean
    :default: true

    When set to true, hovering over an item in the navigation panel causes that item to be marked
    (the background is highlighted).

.. config:option:: $cfg['BrowsePointerEnable']

    :type: boolean
    :default: true

    When set to true, hovering over a row in the Browse page causes that row to be marked (the background
    is highlighted).

.. config:option:: $cfg['BrowseMarkerEnable']

    :type: boolean
    :default: true

    When set to true, a data row is marked (the background is highlighted) when the row is selected
    with the checkbox.

.. config:option:: $cfg['LimitChars']

    :type: integer
    :default: 50

    Maximum number of characters shown in any non-numeric field on browse
    view. Can be turned off by a toggle button on the browse page.

.. config:option:: $cfg['RowActionLinks']

    :type: string
    :default: ``'left'``

    Defines the place where table row links (Edit, Copy, Delete) would be
    put when tables contents are displayed (you may have them displayed at
    the left side, right side, both sides or nowhere).

.. config:option:: $cfg['RowActionLinksWithoutUnique']

    :type: boolean
    :default: false

    Defines whether to show row links (Edit, Copy, Delete) and checkboxes
    for multiple row operations even when the selection does not have a :term:`unique key`.
    Using row actions in the absence of a unique key may result in different/more
    rows being affected since there is no guaranteed way to select the exact row(s).

.. config:option:: $cfg['RememberSorting']

    :type: boolean
    :default: true

    If enabled, remember the sorting of each table when browsing them.

.. config:option:: $cfg['TablePrimaryKeyOrder']

    :type: string
    :default: ``'NONE'``

    This defines the default sort order for the tables, having a :term:`primary key`,
    when there is no sort order defines externally.
    Possible values are:

    * ``NONE``
    * ``ASC``
    * ``DESC``

.. config:option:: $cfg['ShowBrowseComments']

    :type: boolean
    :default: true

.. config:option:: $cfg['ShowPropertyComments']

    :type: boolean
    :default: true

    By setting the corresponding variable to ``true`` you can enable the
    display of column comments in Browse or Property display. In browse
    mode, the comments are shown inside the header. In property mode,
    comments are displayed using a CSS-formatted dashed-line below the
    name of the column. The comment is shown as a tool-tip for that
    column.

.. config:option:: $cfg['FirstDayOfCalendar']

    :type: integer
    :default: 0

    This will define the first day of week in the calendar. The number
    can be set from 0 to 6, which represents the seven days of the week,
    Sunday to Saturday respectively. This value can also be configured by the user
    in :guilabel:`Settings` -> :guilabel:`Features` -> :guilabel:`General` -> :guilabel:`First day of calendar` field.

Text fields
-----------

.. config:option:: $cfg['CharEditing']

    :type: string
    :default: ``'input'``

    Defines which type of editing controls should be used for CHAR and
    VARCHAR columns. Applies to data editing and also to the default values
    in structure editing. Possible values are:

    * ``input`` - this allows to limit size of text to size of columns in MySQL,
      but has problems with newlines in columns
    * ``textarea`` - no problems with newlines in columns, but also no length
      limitations

.. config:option:: $cfg['MinSizeForInputField']

    :type: integer
    :default: 4

    Defines the minimum size for input fields generated for CHAR and
    VARCHAR columns.

.. config:option:: $cfg['MaxSizeForInputField']

    :type: integer
    :default: 60

    Defines the maximum size for input fields generated for CHAR and
    VARCHAR columns.

.. config:option:: $cfg['TextareaCols']

    :type: integer
    :default: 40

.. config:option:: $cfg['TextareaRows']

    :type: integer
    :default: 15

.. config:option:: $cfg['CharTextareaCols']

    :type: integer
    :default: 40

.. config:option:: $cfg['CharTextareaRows']

    :type: integer
    :default: 7

    Number of columns and rows for the textareas. This value will be
    emphasized (\*2) for :term:`SQL` query
    textareas and (\*1.25) for :term:`SQL`
    textareas inside the query window.

    The Char\* values are used for CHAR
    and VARCHAR editing (if configured via :config:option:`$cfg['CharEditing']`).

    .. versionchanged:: 5.0.0

        The default value was changed from 2 to 7.

.. config:option:: $cfg['LongtextDoubleTextarea']

    :type: boolean
    :default: true

    Defines whether textarea for LONGTEXT columns should have double size.

.. config:option:: $cfg['TextareaAutoSelect']

    :type: boolean
    :default: false

    Defines if the whole textarea of the query box will be selected on
    click.

.. config:option:: $cfg['EnableAutocompleteForTablesAndColumns']

    :type: boolean
    :default: true

    Whether to enable autocomplete for table and column names in any
    SQL query box.

SQL query box settings
----------------------

.. config:option:: $cfg['SQLQuery']['Edit']

    :type: boolean
    :default: true

    Whether to display an edit link to change a query in any SQL Query
    box.

.. config:option:: $cfg['SQLQuery']['Explain']

    :type: boolean
    :default: true

    Whether to display a link to explain a SELECT query in any SQL Query
    box.

.. config:option:: $cfg['SQLQuery']['ShowAsPHP']

    :type: boolean
    :default: true

    Whether to display a link to wrap a query in code in any SQL Query
    box. In BetterMyAdmin the link is "Create JS code": it shows the query as
    JavaScript string literals (phpMyAdmin's "Create PHP code"); the directive
    keeps its phpMyAdmin name.

.. config:option:: $cfg['SQLQuery']['Refresh']

    :type: boolean
    :default: true

    Whether to display a link to refresh a query in any SQL Query box.

.. _web-dirs:

Upload/save/import directories
------------------------------

These directories are on the machine (or in the container) where BetterMyAdmin
runs, and are read and written by the user running BetterMyAdmin (``node`` in
the Docker image, where the ``PMA_UPLOADDIR`` and ``PMA_SAVEDIR`` variables set
them). BetterMyAdmin serves only its own application files over HTTP, never
these directories, and it lists and reads only the files inside them (paths
that point outside are refused). Still, give them the strictest permissions you
can, as they may hold complete database dumps.

.. config:option:: $cfg['UploadDir']

    :type: string
    :default: ``''``

    The name of the directory where :term:`SQL` files have been uploaded by
    other means than BetterMyAdmin (for example, FTP). Those files are available
    under a drop-down box when you click the database or table name, then the
    Import tab.

    If
    you want different directory for each user, %u will be replaced with
    username.

    Please note that the file names must have the suffix ".sql"
    (or ".sql.bz2" or ".sql.gz" if support for compressed formats is
    enabled).

    This feature is useful when your file is too big to be
    uploaded via :term:`HTTP` (see :config:option:`$cfg['MaxUploadSize']`).

    .. warning::

        Please see top of this chapter (:ref:`web-dirs`) for instructions how
        to setup this directory and how to make its usage secure.

    .. seealso::

        See :ref:`faq1_16` for alternatives.

.. config:option:: $cfg['SaveDir']

    :type: string
    :default: ``''``

    The name of the directory on the server where exported files can be saved.

    If you want a different directory for each user, %u will be replaced with the
    username.

    Please note that the directory must exist and has to be writable for
    the user running BetterMyAdmin.

    .. warning::

        Please see top of this chapter (:ref:`web-dirs`) for instructions how
        to setup this directory and how to make its usage secure.

.. config:option:: $cfg['TempDir']

    :type: string
    :default: ``'./tmp/'``

    In phpMyAdmin, the name of the directory where temporary files can be
    stored (the templates cache, ESRI Shapefiles import, uploaded files under
    ``open_basedir``).

    .. note::

        BetterMyAdmin has no template cache and does not keep its temporary
        files there: an uploaded import file is staged in a private
        ``bma-import`` subdirectory of the system temporary directory (created
        with mode ``0700``, files ``0600`` with random names, pruned after
        a while). The setup script still shows phpMyAdmin's notice when this
        directive is set; otherwise it has no effect.

Various display setting
-----------------------

.. config:option:: $cfg['RepeatCells']

    :type: integer
    :default: 100

    Repeat the headers every X cells, or 0 to deactivate.

.. config:option:: $cfg['EditInWindow']

    :type: boolean
    :default: true

    .. seealso:: `Feature request to add a pop-up window back <https://github.com/phpmyadmin/phpmyadmin/issues/11983>`_

    .. deprecated:: 4.3.0

        This setting was removed.

.. config:option:: $cfg['QueryWindowWidth']

    :type: integer
    :default: 550

    .. deprecated:: 4.3.0

        This setting was removed.

.. config:option:: $cfg['QueryWindowHeight']

    :type: integer
    :default: 310

    .. deprecated:: 4.3.0

        This setting was removed.

.. config:option:: $cfg['QueryHistoryDB']

    :type: boolean
    :default: false

.. config:option:: $cfg['QueryWindowDefTab']

    :type: string
    :default: ``'sql'``

    .. deprecated:: 4.3.0

        This setting was removed.

.. config:option:: $cfg['QueryHistoryMax']

    :type: integer
    :default: 25

    If :config:option:`$cfg['QueryHistoryDB']` is set to ``true``, all your
    Queries are logged to a table, which has to be created by you (see
    :config:option:`$cfg['Servers'][$i]['history']`). If set to false, all your
    queries will be appended to the form, but only as long as your window is
    opened they remain saved.

    When using the JavaScript based query window, it will always get updated
    when you click on a new table/db to browse and will focus if you click on
    :guilabel:`Edit SQL` after using a query. You can suppress updating the
    query window by checking the box :guilabel:`Do not overwrite this query
    from outside the window` below the query textarea. Then you can browse
    tables/databases in the background without losing the contents of the
    textarea, so this is especially useful when composing a query with tables
    you first have to look in. The checkbox will get automatically checked
    whenever you change the contents of the textarea. Please uncheck the button
    whenever you definitely want the query window to get updated even though
    you have made alterations.

    If :config:option:`$cfg['QueryHistoryDB']` is set to ``true`` you can
    specify the amount of saved history items using
    :config:option:`$cfg['QueryHistoryMax']`.

.. config:option:: $cfg['AllowSharedBookmarks']

    :type: boolean
    :default: true

    .. versionadded:: 6.0.0

    Allow users to create bookmarks that are available for all other users

.. config:option:: $cfg['BrowseMIME']

    :type: boolean
    :default: true

    Enable :ref:`transformations`.

.. config:option:: $cfg['MaxExactCount']

    :type: integer
    :default: 50000

    For InnoDB tables, determines for how large tables BetterMyAdmin should
    get the exact row count using ``SELECT COUNT``. If the approximate row
    count as returned by ``SHOW TABLE STATUS`` is smaller than this value,
    ``SELECT COUNT`` will be used, otherwise the approximate count will be
    used.

    .. versionchanged:: 4.8.0

        The default value was lowered to 50000 for performance reasons.

    .. versionchanged:: 4.2.6

        The default value was changed to 500000.

    .. seealso:: :ref:`faq3_11`

.. config:option:: $cfg['MaxExactCountViews']

    :type: integer
    :default: 0

    For VIEWs, since obtaining the exact count could have an impact on
    performance, this value is the maximum to be displayed, using a
    ``SELECT COUNT ... LIMIT``. Setting this to 0 bypasses any row
    counting.

.. config:option:: $cfg['NaturalOrder']

    :type: boolean
    :default: true

    Sorts database, table names and foreign key constaint according to natural order (for
    example, t1, t2, t10). Currently implemented in the navigation panel,
    in Database view for the table list and Relation view while listing Foreign key constraints.

.. config:option:: $cfg['InitialSlidersState']

    :type: string
    :default: ``'closed'``

    If set to ``'closed'``, the visual sliders are initially in a closed
    state. A value of ``'open'`` does the reverse. To completely disable
    all visual sliders, use ``'disabled'``.

.. config:option:: $cfg['UserprefsDisallow']

    :type: array
    :default: ``[]``

    Contains names of configuration options (keys of the configuration) that
    users can't set through user preferences. For possible values, refer
    to the user preference forms in :file:`packages/config/src/forms.ts`
    (phpMyAdmin's :file:`src/Config/Forms/User/`).

.. config:option:: $cfg['UserprefsDeveloperTab']

    :type: boolean
    :default: false

    .. versionadded:: 3.4.0

    Activates in the user preferences a tab containing options for
    developers of BetterMyAdmin.

Page titles
-----------

The page title displayed by your browser's window or tab title bar can be customized. You can use :ref:`faq6_27`.
The following four options allow customizing various parts of the BetterMyAdmin interface. Note that the login page
title cannot be changed.

.. config:option:: $cfg['TitleTable']

    :type: string
    :default: ``'@HTTP_HOST@ / @VSERVER@ / @DATABASE@ / @TABLE@ | @PHPMYADMIN@'``

.. config:option:: $cfg['TitleDatabase']

    :type: string
    :default: ``'@HTTP_HOST@ / @VSERVER@ / @DATABASE@ | @PHPMYADMIN@'``

.. config:option:: $cfg['TitleServer']

    :type: string
    :default: ``'@HTTP_HOST@ / @VSERVER@ | @PHPMYADMIN@'``

.. config:option:: $cfg['TitleDefault']

    :type: string
    :default: ``'@HTTP_HOST@ | @PHPMYADMIN@'``

    In BetterMyAdmin, ``@PHPMYADMIN@`` is replaced by "BetterMyAdmin" and its
    version.

Theme manager settings
----------------------

.. config:option:: $cfg['ThemeManager']

    :type: boolean
    :default: true

    Enables user-selectable themes. See :ref:`faqthemes`.

.. config:option:: $cfg['ThemeDefault']

    :type: string
    :default: ``'pmahomme'``

    The default theme: one of ``pmahomme``, ``original``, ``metro`` and
    ``bootstrap`` (phpMyAdmin's themes), or ``modern``, ``classic`` and
    ``native`` (BetterMyAdmin's own). An unknown name falls back to
    ``pmahomme``. See :ref:`themes`.

.. config:option:: $cfg['ThemePerServer']

    :type: boolean
    :default: false

    Whether to allow different theme for each server.

.. config:option:: $cfg['FontSize']

    :type: string
    :default: '82%'

    .. deprecated:: 5.0.0

        This setting was removed as the browser is more efficient,
        thus no need of this option.

    Font size to use, is applied in CSS.

Default queries
---------------

.. config:option:: $cfg['DefaultQueryTable']

    :type: string
    :default: ``'SELECT * FROM @TABLE@ WHERE 1'``

.. config:option:: $cfg['DefaultQueryDatabase']

    :type: string
    :default: ``''``

    Default queries that will be displayed in query boxes when user didn't
    specify any. You can use standard :ref:`faq6_27`.

MySQL settings
--------------

.. config:option:: $cfg['DefaultFunctions']

    :type: array
    :default: ``['FUNC_CHAR' => '', 'FUNC_DATE' => '', 'FUNC_NUMBER' => '', 'FUNC_SPATIAL' => 'GeomFromText', 'FUNC_UUID' => 'UUID', 'first_timestamp' => 'NOW']``

    Functions selected by default when inserting/changing row, Functions
    are defined for meta types as (``FUNC_NUMBER``, ``FUNC_DATE``, ``FUNC_CHAR``,
    ``FUNC_SPATIAL``, ``FUNC_UUID``) and for ``first_timestamp``, which is used
    for first timestamp column in table.

    Example configuration

    .. code-block:: json

        {
          "DefaultFunctions": {
            "FUNC_CHAR": "",
            "FUNC_DATE": "",
            "FUNC_NUMBER": "",
            "FUNC_SPATIAL": "ST_GeomFromText",
            "FUNC_UUID": "UUID",
            "first_timestamp": "UTC_TIMESTAMP"
          }
        }

Default options for Transformations
-----------------------------------

.. config:option:: $cfg['DefaultTransformations']

    :type: array
    :default: An array with below listed key-values

.. config:option:: $cfg['DefaultTransformations']['Substring']

    :type: array
    :default: ``[0, 'all', '…']``

.. config:option:: $cfg['DefaultTransformations']['Bool2Text']

    :type: array
    :default: ``['T', 'F']``

.. config:option:: $cfg['DefaultTransformations']['External']

    :type: array
    :default: ``[0, '-f /dev/null -i -wrap -q', 1, 1]``

.. config:option:: $cfg['DefaultTransformations']['PreApPend']

    :type: array
    :default: ``['', '']``

.. config:option:: $cfg['DefaultTransformations']['Hex']

    :type: array
    :default: ``['2']``

.. config:option:: $cfg['DefaultTransformations']['DateFormat']

    :type: array
    :default: ``[0, '', 'local']``

.. config:option:: $cfg['DefaultTransformations']['Inline']

    :type: array
    :default: ``['100', 100]``

.. config:option:: $cfg['DefaultTransformations']['TextImageLink']

    :type: array
    :default: ``['', 100, 50]``

.. config:option:: $cfg['DefaultTransformations']['TextLink']

    :type: array
    :default: ``['', '', '']``

Console settings
----------------

.. note::

    These settings are mostly meant to be changed by user.

.. config:option:: $cfg['Console']['StartHistory']

    :type: boolean
    :default: false

    Show query history at start

.. config:option:: $cfg['Console']['AlwaysExpand']

    :type: boolean
    :default: false

    Always expand query messages

.. config:option:: $cfg['Console']['CurrentQuery']

    :type: boolean
    :default: true

    Show current browsing query

.. config:option:: $cfg['Console']['EnterExecutes']

    :type: boolean
    :default: false

    Execute queries on Enter and insert new line with Shift+Enter

.. config:option:: $cfg['Console']['DarkTheme']

    :type: boolean
    :default: false

    Switch to dark theme

.. config:option:: $cfg['Console']['Mode']

    :type: string
    :default: ``'info'``

    Console mode

.. config:option:: $cfg['Console']['Height']

    :type: integer
    :default: 92

    Console height

Developer
---------

.. warning::

    These settings might have huge effect on performance or security.

.. config:option:: $cfg['environment']

    :type: string
    :default: ``'production'``

    Sets the working environment.

    This only needs to be changed when you are developing BetterMyAdmin itself.
    The ``development`` mode may display debug information in some places.

    Possible values are ``'production'`` or ``'development'``.

.. config:option:: $cfg['DBG']

    :type: array
    :default: []

.. config:option:: $cfg['DBG']['sql']

    :type: boolean
    :default: false

    Enable logging queries and execution times to be
    displayed in the console's Debug SQL tab.

.. config:option:: $cfg['DBG']['sqllog']

    :type: boolean
    :default: false

    Enable logging of queries and execution times. phpMyAdmin sends them to
    syslog; BetterMyAdmin writes the same lines to the server's error output
    (stderr) when each request ends.
    Requires :config:option:`$cfg['DBG']['sql']` to be enabled.

.. config:option:: $cfg['DBG']['demo']

    :type: boolean
    :default: false

    Enable to let server present itself as demo server, like the
    `phpMyAdmin demo server <https://www.phpmyadmin.net/try/>`_.

    It currently changes following behavior:

    * There is welcome message on the main page.
    * There is footer information about demo server and used Git revision.
    * The setup script is enabled even with existing configuration.
    * The setup does not try to connect to the MySQL server.

.. config:option:: $cfg['DBG']['simple2fa']

    :type: boolean
    :default: false

    Can be used for testing two-factor authentication using :ref:`simple2fa`.

.. _config-examples:

Examples
--------

See following configuration snippets for typical setups of BetterMyAdmin.
Each one is a complete :file:`bettermyadmin.config.json`, or a part to merge
into yours.

Basic example
+++++++++++++

Example configuration file, which can be copied to
:file:`bettermyadmin.config.json` to get some core configuration layout (it
plays the role of phpMyAdmin's :file:`config.sample.inc.php`). Please note
that it does not contain all configuration options, only the most frequently
used ones.

.. code-block:: json

    {
      "blowfish_secret": "a string of 32 random characters",
      "Servers": [
        {
          "auth_type": "cookie",
          "host": "localhost",
          "compress": false,
          "AllowNoPassword": false,

          "controlhost": "",
          "controlport": "",
          "controluser": "pma",
          "controlpass": "pmapass",

          "pmadb": "phpmyadmin",
          "bookmarktable": "pma__bookmark",
          "relation": "pma__relation",
          "table_info": "pma__table_info",
          "table_coords": "pma__table_coords",
          "pdf_pages": "pma__pdf_pages",
          "column_info": "pma__column_info",
          "history": "pma__history",
          "table_uiprefs": "pma__table_uiprefs",
          "tracking": "pma__tracking",
          "userconfig": "pma__userconfig",
          "recent": "pma__recent",
          "favorite": "pma__favorite",
          "users": "pma__users",
          "usergroups": "pma__usergroups",
          "navigationhiding": "pma__navigationhiding",
          "savedsearches": "pma__savedsearches",
          "central_columns": "pma__central_columns",
          "designer_settings": "pma__designer_settings",
          "export_templates": "pma__export_templates"
        }
      ],
      "UploadDir": "",
      "SaveDir": ""
    }

The same file as YAML (:file:`bettermyadmin.config.yaml`) or as a TypeScript
module (:file:`bettermyadmin.config.ts`, see :ref:`setup`) is equally valid.

.. warning::

    Don't use the controluser 'pma' if it does not yet exist and don't use 'pmapass'
    as password.

.. _example-signon:

Example for signon authentication
+++++++++++++++++++++++++++++++++

This example uses :file:`apps/server/examples/signon-page.mjs` to
demonstrate usage of :ref:`auth_signon`, with the login page served by
BetterMyAdmin itself (:config:option:`$cfg['Servers'][$i]['SignonPage']`):

.. code-block:: json

    {
      "Servers": [{
        "auth_type": "signon",
        "SignonSession": "SignonSession",
        "SignonURL": "/signon/",
        "LogoutURL": "/signon/?logout",
        "SignonPage": "./apps/server/examples/signon-page.mjs"
      }]
    }

With a separate login application, such as
:file:`apps/server/examples/signon.ts` (listening on port 8090), point
:config:option:`$cfg['Servers'][$i]['SignonURL']` at it instead:

.. code-block:: json

    {
      "Servers": [{
        "auth_type": "signon",
        "SignonSession": "SignonSession",
        "SignonURL": "http://localhost:8090/"
      }]
    }

Example for IP address limited autologin
++++++++++++++++++++++++++++++++++++++++

If you want to automatically login when accessing BetterMyAdmin locally while
asking for a password when accessing remotely, phpMyAdmin's configuration
tests ``$_SERVER['REMOTE_ADDR']`` in PHP. A configuration file of
BetterMyAdmin is read once at start, not on each request, so this cannot be
done in the file. Run two instances instead: one listening on ``127.0.0.1``
only with ``config`` authentication, and a public one with ``cookie``
authentication:

.. code-block:: json

    {
      "Listen": { "host": "127.0.0.1", "port": 8081 },
      "Servers": [{ "auth_type": "config", "user": "root", "password": "yourpassword" }]
    }

.. note::

    Filtering based on IP addresses isn't reliable over the internet, use it
    only for local address.

Example for using multiple MySQL servers
++++++++++++++++++++++++++++++++++++++++

You can configure any number of servers using :config:option:`$cfg['Servers']`,
following example shows two of them:

.. code-block:: json

    {
      "blowfish_secret": "a string of 32 random characters",
      "Servers": [
        { "auth_type": "cookie", "verbose": "no1", "host": "localhost" },
        { "auth_type": "cookie", "verbose": "no2", "host": "remote.host.addr" }
      ],
      "ServerDefault": 0
    }

The second server must allow remote clients (e.g. host ``10.9.8.%``), not only
in ``mysql.user`` but also in its startup configuration.
:config:option:`$cfg['ServerDefault']` ``0`` lets the user choose the server
on startup.

.. _example-google-ssl:

Google Cloud SQL with SSL
+++++++++++++++++++++++++

To connect to Google Could SQL, you may need to disable certificate
verification. This is caused by the certificate being issued for CN matching
your instance name, but you connect to an IP address and the name check
fails. With verification you end up with an error message about the
certificate name not matching the host.

.. warning::

    With disabled verification your traffic is encrypted, but you're open to
    man in the middle attacks.

To connect BetterMyAdmin to Google Cloud SQL using SSL download the client and
server certificates and tell BetterMyAdmin to use them:

.. code-block:: json

    {
      "Servers": [{
        "host": "8.8.8.8",
        "ssl": true,
        "ssl_key": "../client-key.pem",
        "ssl_cert": "../client-cert.pem",
        "ssl_ca": "../server-ca.pem",
        "ssl_verify": false
      }]
    }

``host`` is the IP address of your instance; ``ssl_key`` the client secret
key, ``ssl_cert`` the client certificate and ``ssl_ca`` the server
certification authority. A relative path is resolved against BetterMyAdmin's
working directory.

.. seealso::

    :ref:`ssl`,
    :config:option:`$cfg['Servers'][$i]['ssl']`,
    :config:option:`$cfg['Servers'][$i]['ssl_key']`,
    :config:option:`$cfg['Servers'][$i]['ssl_cert']`,
    :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
    :config:option:`$cfg['Servers'][$i]['ssl_verify']`

.. _example-aws-ssl:

Amazon RDS Aurora with SSL
++++++++++++++++++++++++++

To connect BetterMyAdmin to an Amazon RDS Aurora MySQL database instance using SSL,
download the CA server certificate and tell BetterMyAdmin to use it:

.. code-block:: json

    {
      "Servers": [{
        "host": "replace-me-cluster-name.cluster-replace-me-id.replace-me-region.rds.amazonaws.com",
        "ssl": true,
        "ssl_ca": "../rds-combined-ca-bundle.pem",
        "ssl_verify": true
      }]
    }

You need to have the region CA file and the authority CA file (2019 edition CA
for example) in the PEM bundle for it to work.

.. seealso::

    :ref:`ssl`,
    :config:option:`$cfg['Servers'][$i]['ssl']`,
    :config:option:`$cfg['Servers'][$i]['ssl_ca']`,
    :config:option:`$cfg['Servers'][$i]['ssl_verify']`

.. seealso::

    - Current RDS CA bundle for all regions https://s3.amazonaws.com/rds-downloads/rds-combined-ca-bundle.pem
    - The RDS CA (2019 edition) for the region `eu-west-3` without the parent CA https://s3.amazonaws.com/rds-downloads/rds-ca-2019-eu-west-3.pem
    - `List of available Amazon RDS CA files <https://s3.amazonaws.com/rds-downloads/>`_
    - `Amazon MySQL Aurora security guide <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Security.html>`_
    - `Amazon certificates bundles per region <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.SSL.html>`_

reCaptcha using hCaptcha
++++++++++++++++++++++++

``CaptchaLoginPrivateKey`` is the secret key and ``CaptchaLoginPublicKey`` the
site key from the hCaptcha dashboard:

.. code-block:: json

    {
      "CaptchaApi": "https://js.hcaptcha.com/1/api.js",
      "CaptchaCsp": "https://hcaptcha.com https://*.hcaptcha.com",
      "CaptchaRequestParam": "h-captcha",
      "CaptchaResponseParam": "h-captcha-response",
      "CaptchaSiteVerifyURL": "https://hcaptcha.com/siteverify",
      "CaptchaLoginPrivateKey": "0xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "CaptchaLoginPublicKey": "xxx-xxx-xxx-xxx-xxxx"
    }

.. seealso:: `hCaptcha website <https://www.hcaptcha.com/>`_
.. seealso:: `hCaptcha Developer Guide <https://docs.hcaptcha.com/>`_

reCaptcha using Turnstile
+++++++++++++++++++++++++

.. code-block:: json

    {
      "CaptchaMethod": "checkbox",
      "CaptchaApi": "https://challenges.cloudflare.com/turnstile/v0/api.js",
      "CaptchaCsp": "https://challenges.cloudflare.com https://static.cloudflareinsights.com",
      "CaptchaRequestParam": "cf-turnstile",
      "CaptchaResponseParam": "cf-turnstile-response",
      "CaptchaLoginPublicKey": "0xxxxxxxxxxxxxxxxxxxxxx",
      "CaptchaLoginPrivateKey": "0x4AAAAAAAA_xx_xxxxxxxxxxxxxxxxxxxx",
      "CaptchaSiteVerifyURL": "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    }

.. seealso:: `Cloudflare Dashboard <https://dash.cloudflare.com/>`_
.. seealso:: `Turnstile Developer Guide <https://developers.cloudflare.com/turnstile/get-started/>`_

reCaptcha using Google reCaptcha v2/v3
++++++++++++++++++++++++++++++++++++++

Remove ``CaptchaMethod`` if you do not want the checkbox mode:

.. code-block:: json

    {
      "CaptchaLoginPublicKey": "xxxxxxxxxxxxxxxx-xxxxxxxxxxxx",
      "CaptchaLoginPrivateKey": "xxxxxxxxx-xxxxxxxxxxxxxx",
      "CaptchaMethod": "checkbox"
    }

.. seealso:: `Google reCaptcha Developer's Guide <https://developers.google.com/recaptcha/intro>`_
.. seealso:: `Google reCaptcha types <https://developers.google.com/recaptcha/docs/versions>`_
