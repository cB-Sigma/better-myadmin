.. _status_insights:

Server status: dashboard and slow queries
=========================================

Besides phpMyAdmin's Status pages (Server, Processes, Query statistics, All status variables,
Monitor, Advisor), BetterMyAdmin adds two pages to the pills of *Status*. Opening *Status* still
shows phpMyAdmin's *Server* page first.

.. _status_dashboard:

Dashboard
---------

*Status › Dashboard* shows the server's health as cards that update on their own:

* queries per second (the ``Questions`` counter),
* connections: connected threads out of ``max_connections``, the most used at once and the aborted
  connections and clients,
* threads running,
* InnoDB buffer pool hit rate (the share of read requests served from memory) and usage,
* bytes received and sent per second,
* slow queries per minute,
* table locks waited per second,
* the share of temporary tables created on disk,
* the replication lag (``Seconds_Behind_Source``) and the replication threads, when the server is a
  replica.

The header shows the server version and uptime. Every few seconds (2, 5, 10 or 30, chosen with
*Refresh rate*) the page reads the server's counters once (``SHOW GLOBAL STATUS`` and ``SHOW GLOBAL
VARIABLES`` for these names only, and the replica status) and computes the rates from the change
since the previous reading. The small chart of each card shows the last 60 readings; hover it to
see a value and its time. *Pause monitor* stops the readings, and so does hiding the browser tab:
reading resumes, with a gap in the charts, when the tab is shown again.

A card turns yellow (*Warning*) or red (*Critical*) at these thresholds:

========================================  ===========  ===========
Card                                      Warning      Critical
========================================  ===========  ===========
Connections (of ``max_connections``)      80 %         95 %
InnoDB buffer pool hit rate               below 99 %   below 95 %
Temporary tables on disk                  25 %         50 %
Slow queries                              1 / minute   10 / minute
Table locks waited                        0.1 / s      1 / s
Replication lag                           30 s         300 s, or a stopped thread
========================================  ===========  ===========

The counters need no privilege. The replication lag needs ``REPLICATION CLIENT`` (MariaDB: ``REPLICA
MONITOR`` or ``SLAVE MONITOR``); without it the page says so instead of showing the card.

.. _status_slow_queries:

Slow queries
------------

*Status › Slow queries* lists the statements that took the most time, without having to turn the
slow query log on. It reads the statement summaries of ``performance_schema``
(``events_statements_summary_by_digest``): statements that differ only by their values share one
row, with placeholders (``?``) for the values. For each, the page shows how often it ran, the total,
average and longest time, the rows examined and sent, errors and warnings, and when it was first and
last seen. Click a column to sort by it, choose a *Database* to see only the statements run in it
(their default database). The top 100 rows are shown.

*Source* switches to the slow query log when it is written to a table (``log_output`` includes
``TABLE``): its entries are grouped the same way, by the statement with its values replaced.

Click a statement to see it formatted and an example of it with real values: the one
``performance_schema`` keeps (``QUERY_SAMPLE_TEXT`` on MySQL 8, else the statement history), or the
newest slow-log entry. *Explain SQL* runs ``EXPLAIN`` of that example and shows the plan. Nothing else
is ever run: only a single ``SELECT``, ``WITH``, ``INSERT``, ``UPDATE``, ``DELETE``, ``REPLACE`` or
``TABLE`` statement is explained, and only when you click. When no example is kept, *Open in the SQL
tab* puts the statement in the SQL box, where you replace the placeholders with values.

*Reset statistics* empties the summaries for the whole server (``TRUNCATE`` of the summary table,
after a confirmation). It is shown only to accounts with the ``DROP`` privilege on that table.

When the source cannot be read the page says why and how to enable it:

* ``performance_schema`` is off: set ``performance_schema = ON`` in the server's configuration file
  and restart the server. MariaDB has it off by default. See the `MySQL manual
  <https://dev.mysql.com/doc/refman/8.4/en/performance-schema-quick-start.html>`_ or the `MariaDB
  knowledge base <https://mariadb.com/kb/en/performance-schema-overview/>`_.
* the account cannot read it: it needs ``SELECT`` on ``performance_schema``.
* the ``statements_digest`` consumer is disabled: ``UPDATE performance_schema.setup_consumers SET
  ENABLED = 'YES' WHERE NAME = 'statements_digest';``
* for the slow log: ``SET GLOBAL slow_query_log = ON;`` and ``SET GLOBAL log_output =
  'FILE,TABLE';`` (``long_query_time`` decides which statements are logged), and ``SELECT`` on
  ``mysql.slow_log``.
