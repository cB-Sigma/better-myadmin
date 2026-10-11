-- Seed of the export/import parity suites (docs/features/07-export-import.md).
-- Every column type, keys of every kind, a foreign key, a trigger, routines, an event,
-- views (one depending on another), an ARCHIVE table, an empty table, a multi-row table
-- for the extended-insert split and awkward identifiers. Runs inside the target database.
CREATE TABLE `types` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ti` TINYINT DEFAULT NULL,
  `si` SMALLINT NOT NULL DEFAULT '0',
  `mi` MEDIUMINT DEFAULT NULL,
  `bi` BIGINT DEFAULT NULL,
  `zf` INT(6) UNSIGNED ZEROFILL DEFAULT NULL,
  `dec` DECIMAL(10,2) DEFAULT NULL,
  `fl` FLOAT DEFAULT NULL,
  `dbl` DOUBLE DEFAULT NULL,
  `bt` BIT(5) DEFAULT NULL,
  `bo` TINYINT(1) DEFAULT NULL,
  `d` DATE DEFAULT NULL,
  `dt` DATETIME(3) DEFAULT NULL,
  `ts` TIMESTAMP NULL DEFAULT NULL,
  `tm` TIME DEFAULT NULL,
  `yr` YEAR DEFAULT NULL,
  `ch` CHAR(5) DEFAULT NULL,
  `vc` VARCHAR(64) COLLATE utf8mb4_unicode_ci DEFAULT 'x' COMMENT 'a ''quoted'' comment',
  `bn` BINARY(4) DEFAULT NULL,
  `vb` VARBINARY(16) DEFAULT NULL,
  `tt` TINYTEXT,
  `tx` TEXT,
  `mt` MEDIUMTEXT,
  `lt` LONGTEXT,
  `tb` TINYBLOB,
  `bl` BLOB,
  `mb` MEDIUMBLOB,
  `lb` LONGBLOB,
  `en` ENUM('a','b''c','d,e') DEFAULT 'a',
  `st` SET('x','y','z') DEFAULT NULL,
  `js` JSON DEFAULT NULL,
  `geo` GEOMETRY DEFAULT NULL,
  `pt` POINT DEFAULT NULL,
  `ls` LINESTRING DEFAULT NULL,
  `pg` POLYGON DEFAULT NULL,
  `gen` BIGINT GENERATED ALWAYS AS ((`si` * 2)) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `u_ch` (`ch`),
  KEY `k_multi` (`si`,`mi`) COMMENT 'multi column',
  FULLTEXT KEY `ft_tx` (`tx`),
  FULLTEXT KEY `ft_mt` (`mt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='every type';

INSERT INTO `types` (`ti`, `si`, `mi`, `bi`, `zf`, `dec`, `fl`, `dbl`, `bt`, `bo`, `d`, `dt`, `ts`, `tm`, `yr`, `ch`, `vc`, `bn`, `vb`, `tt`, `tx`, `mt`, `lt`, `tb`, `bl`, `mb`, `lb`, `en`, `st`, `js`, `geo`, `pt`, `ls`, `pg`) VALUES
  (-128, 32767, -8388608, 9223372036854775807, 42, -12345678.90, 1.5, 3.14159265358979, b'10101', 1, '2024-02-29', '2024-02-29 13:14:15.123', '2024-03-01 00:00:01', '-838:59:59', 2024, 'abc', 'it''s "quoted" \\ back', 0x00ff1027, 0x000102, 'tiny', 'line1\nline2\r\nline3\ttab', 'medium ünïcödé ✓ 😀', REPEAT('long', 50), 0x00, 0xdeadbeef, '', 0x27225c00, 'b''c', 'x,z', '{"a": [1, 2, {"b": null}], "s": "q\\"t"}', ST_GeomFromText('POINT(1 2)'), ST_GeomFromText('POINT(3 4)'), ST_GeomFromText('LINESTRING(0 0,1 1,2 1)'), ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))')),
  (NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (0, -1, 0, 0, 0, 0.00, 0, 0, b'0', 0, '1000-01-01', '1000-01-01 00:00:00.000', '1970-01-01 00:00:01', '00:00:00', 1901, '', '', 0x00000000, X'', '', '', '', '', X'', X'', X'', 0x30, 'd,e', '', 'null', NULL, NULL, NULL, NULL),
  (1, 1, 1, -9223372036854775808, 1, 99999999.99, -0.000123, 1e300, b'11111', NULL, '9999-12-31', '9999-12-31 23:59:59.999', '2038-01-19 03:14:07', '838:59:59', 2155, 'zzzzz', '<tag attr="v">&amp;</tag>', 0x41424344, 'text', '$%{}&#_^~\\', 'a|b||c', '0', 'NULL', 'blob as text', 'ab\0cd', 0x1a, 0x0d0a, 'a', 'x,y,z', '[]', ST_GeomFromText('MULTIPOINT((1 1),(2 2))'), NULL, NULL, NULL);

CREATE TABLE `child` (
  `cid` INT NOT NULL AUTO_INCREMENT,
  `type_id` INT UNSIGNED DEFAULT NULL,
  `label` VARCHAR(20) NOT NULL DEFAULT '',
  PRIMARY KEY (`cid`),
  KEY `fk_type` (`type_id`),
  CONSTRAINT `fk_type` FOREIGN KEY (`type_id`) REFERENCES `types` (`id`) ON DELETE CASCADE ON UPDATE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `child` (`cid`, `type_id`, `label`) VALUES (1, 1, 'one'), (2, 2, 'two'), (5, NULL, 'none');

CREATE TABLE `many` (
  `n` INT NOT NULL,
  `txt` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`n`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `many` (`n`, `txt`)
  WITH RECURSIVE seq (k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM seq WHERE k < 150)
  SELECT k, CONCAT('row number ', k, ' ', REPEAT('é', k % 7)) FROM seq;

CREATE TABLE `empty_t` (
  `a` INT DEFAULT NULL,
  `b` VARCHAR(5) DEFAULT NULL
) ENGINE=MyISAM DEFAULT CHARSET=latin1;

CREATE TABLE `arch` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `msg` VARCHAR(30) DEFAULT NULL,
  KEY `id` (`id`)
) ENGINE=ARCHIVE AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `arch` (`id`, `msg`) VALUES (1, 'archived'), (2, 'again');

CREATE TABLE `we``ird name` (
  `col with space` INT NOT NULL,
  `select` VARCHAR(10) DEFAULT NULL,
  `ünï` DECIMAL(5,1) DEFAULT '1.5',
  PRIMARY KEY (`col with space`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `we``ird name` VALUES (1, 'from', 2.5), (2, NULL, NULL);

CREATE TRIGGER `child_bi` BEFORE INSERT ON `child` FOR EACH ROW SET NEW.`label` = UPPER(NEW.`label`);
CREATE TRIGGER `child_au` AFTER UPDATE ON `child` FOR EACH ROW BEGIN
  IF NEW.`label` = '' THEN
    SET @x = 1;
  END IF;
END;

CREATE PROCEDURE `proc_one`(IN `p` INT, OUT `q` VARCHAR(10))
  COMMENT 'a procedure'
BEGIN
  SELECT COUNT(*) INTO `q` FROM `types` WHERE `si` > `p`;
END;

CREATE FUNCTION `fn_double`(`x` INT) RETURNS INT DETERMINISTIC
  RETURN `x` * 2;

CREATE EVENT `ev_cleanup` ON SCHEDULE EVERY 1 DAY STARTS '2030-01-01 00:00:00' ON COMPLETION PRESERVE DISABLE
  COMMENT 'never runs' DO DELETE FROM `child` WHERE `label` = 'zzz';

CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `v_types` AS
  SELECT `id`, `vc`, `si` * 2 AS `twice`, `d` FROM `types` WHERE `id` < 10;

CREATE VIEW `v_nested` AS SELECT `id`, `twice` FROM `v_types`;
