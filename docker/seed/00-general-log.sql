-- The parity harness reads mysql.general_log by time window (tests/parity/lib/general-log.ts).
-- The default CSV engine cannot be indexed, so every read scanned the whole log (90 s at 887k rows):
-- MyISAM with an event_time index makes a read cost its window. GeneralLog.open() applies the same
-- change to an existing server and rotates the log while no suite holds a marker.
SET GLOBAL general_log = 'OFF';
ALTER TABLE mysql.general_log ENGINE = MyISAM;
ALTER TABLE mysql.general_log ADD INDEX bma_event_time (event_time);
SET GLOBAL general_log = 'ON';
