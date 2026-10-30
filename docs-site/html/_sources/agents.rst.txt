.. _agents:

AI agents and scripts
=====================

BetterMyAdmin has a small JSON API and an `MCP <https://modelcontextprotocol.io>`_ endpoint for
programs that do not need the web interface: AI agents (Claude Code, Claude Desktop, Cursor, …),
scripts and CI jobs. Both are off until :config:option:`$cfg['AgentApi']` is set to ``true``.

Every request carries its own credentials; there is no session and no CSRF token. A request
authenticates as a MySQL user, as people do when they log in, and that user's privileges decide
what it can see and change. The login rules apply as for a login:
:config:option:`$cfg['Servers'][$i]['AllowDeny']['rules']`,
:config:option:`$cfg['Servers'][$i]['AllowRoot']`,
:config:option:`$cfg['Servers'][$i]['AllowNoPassword']` and the failed-login limiter.

How a request authenticates depends on the server's
:config:option:`$cfg['Servers'][$i]['auth_type']`:

``cookie``, ``http``
    HTTP Basic with the MySQL user and password (``Authorization: Basic …``). A request without
    them gets ``401`` with ``WWW-Authenticate: Basic``.
``config``
    The configured user; the request needs no credentials. Protect such a server's address as
    you would its web interface.
``signon``
    The :config:option:`$cfg['Servers'][$i]['SignonPage']` module's ``agentCredentials`` export,
    which reads the credentials from the request (for example a single sign-on proxy's header) and
    returns ``{user, password}``, or ``null`` when the request has none.

Requests from a web page of another site are refused (an ``Origin`` header of another host), and a
``POST`` must be ``Content-Type: application/json``: browsers send HTTP Basic credentials and a
sign-on proxy's cookie on their own, so this keeps other sites from using them.

The API
-------

All paths are below ``/api/agent/v1/servers/<n>``, where ``<n>`` is the server's number (``1`` for
the first). Answers are JSON; errors are ``{"error": {"code": …, "message": …}}`` with an HTTP
status (a MySQL error adds ``errno`` and ``sqlstate``).

``GET /databases``
    ``{"databases": [...]}``: the databases the user may see, after
    :config:option:`$cfg['Servers'][$i]['only_db']` and :config:option:`$cfg['Servers'][$i]['hide_db']`.

``GET /databases/<db>/tables``
    ``{"tables": [{"name", "type": "table"|"view", "engine", "rows", "comment"}]}``. ``rows`` is the
    storage engine's estimate.

``GET /databases/<db>/tables/<table>``
    The columns (name, type, nullable, key, default, extra, collation, comment), the indexes and the
    ``CREATE TABLE`` statement.

``POST /query`` ``{"sql": "...", "db": "...", "maxRows": 100}``
    Runs the SQL like the SQL box: statements split on ``;``, ``db`` as the default database, a
    ``SELECT`` without ``LIMIT`` limited to ``maxRows`` rows (default
    :config:option:`$cfg['MaxRows']`, at most 10000; ``truncated`` says when there were more), and
    ``DROP DATABASE`` refused unless :config:option:`$cfg['AllowUserDropDatabase']`. Execution
    stops at the first failing statement. Each statement comes back with ``columns`` and ``rows``,
    or ``affectedRows`` / ``insertId``, or its ``error``. Values are strings exactly as the server
    sent them (``DECIMAL`` and ``BIGINT`` keep every digit), ``NULL`` is ``null``, and binary values
    are ``{"base64": "..."}``.

``POST /explain`` ``{"sql": "...", "db": "..."}``
    The server's ``EXPLAIN`` of one statement, in the same form.

For example::

    curl -u 'reporter:secret' -H 'Content-Type: application/json' \
      -d '{"sql": "SELECT COUNT(*) FROM orders", "db": "shop"}' \
      https://bma.example.com/api/agent/v1/servers/1/query

MCP
---

``POST /api/agent/v1/servers/<n>/mcp`` is an MCP server (Streamable HTTP transport, JSON
responses, no session). Its tools are ``list_databases``, ``list_tables``, ``describe_table``,
``query`` and ``explain``, with the API's answers as their results. For Claude Code, add it to the
project's ``.mcp.json``:

.. code-block:: json

    {
      "mcpServers": {
        "bettermyadmin": {
          "type": "http",
          "url": "https://bma.example.com/api/agent/v1/servers/1/mcp",
          "headers": { "Authorization": "Basic cmVwb3J0ZXI6c2VjcmV0" }
        }
      }
    }

Behind Cloudflare Access (the signon setup of the ``phpmyadmin-sso`` image), the headers are a
service token's instead: ``"CF-Access-Client-Id"`` and ``"CF-Access-Client-Secret"``. The token
signs on as its own MySQL user (``svc-…``), created without privileges: grant it what the agent
may do.
