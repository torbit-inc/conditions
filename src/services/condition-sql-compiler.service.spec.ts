import {
  ConditionSqlCompilerService,
  FieldSqlBinding,
} from './condition-sql-compiler.service';
import { Condition } from '../types/condition.type';

/** Collapse whitespace so SQL-shape assertions are robust to formatting. */
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('ConditionSqlCompilerService', () => {
  let service: ConditionSqlCompilerService;

  beforeEach(() => {
    service = new ConditionSqlCompilerService();
  });

  /**
   * Test resolver: typed columns become native column refs; anything under
   * `industryData.` becomes a JSONB text extract. Mirrors the prelegal mapper.
   */
  const resolveField = (path: string): FieldSqlBinding | null => {
    const columns: Record<string, FieldSqlBinding> = {
      currentStage: { sql: 'd."currentStage"', kind: 'column', type: 'string' },
      grupo: { sql: 'd."grupo"', kind: 'column', type: 'number' },
      totalOwedAmount: {
        sql: 'd."totalOwedAmount"',
        kind: 'column',
        type: 'number',
      },
      createdAt: { sql: 'd."createdAt"', kind: 'column', type: 'date' },
    };
    if (columns[path]) return columns[path];
    if (path.startsWith('industryData.')) {
      const key = path.slice('industryData.'.length);
      /* cuotasEnMora is a numeric count; fechaAlta is a date; else string. */
      const type: FieldSqlBinding['type'] =
        key === 'cuotasEnMora'
          ? 'number'
          : key === 'fechaAlta'
            ? 'date'
            : 'string';
      return {
        sql: `(d."industryData" #>> '{${key}}')`,
        kind: 'json',
        type,
      };
    }
    return null;
  };

  const compile = (condition: Condition) =>
    service.compile(condition, { resolveField });

  describe('leaf operators', () => {
    it('eq on a string column → "=" with the value as a param', () => {
      const { sql, parameters } = compile({
        field: 'currentStage',
        operator: 'eq',
        value: 'AP1',
      });
      // Native column compared raw (no CAST) so the column index stays usable.
      expect(norm(sql)).toMatch(/\(d\."currentStage"\) = :c0/);
      expect(norm(sql)).not.toContain('CAST');
      expect(Object.values(parameters)).toEqual(['AP1']);
    });

    it('eq on a number column coerces the expected value to a number', () => {
      const { parameters } = compile({
        field: 'grupo',
        operator: 'eq',
        value: '7',
      });
      expect(Object.values(parameters)).toEqual([7]);
    });

    it('neq → "<>"', () => {
      const { sql } = compile({
        field: 'currentStage',
        operator: 'neq',
        value: 'AP1',
      });
      expect(norm(sql)).toContain('<> :c0');
    });

    it('gt on a numeric column → numeric comparison', () => {
      const { sql, parameters } = compile({
        field: 'totalOwedAmount',
        operator: 'gt',
        value: '1000',
      });
      // Numeric column compared raw; the expected value is coerced to a number.
      expect(norm(sql)).toMatch(/\(d\."totalOwedAmount"\) > :c0/);
      expect(Object.values(parameters)).toEqual([1000]);
    });

    it('between → BETWEEN with two coerced params', () => {
      const { sql, parameters } = compile({
        field: 'grupo',
        operator: 'between',
        value: ['10', '20'],
      });
      expect(norm(sql)).toMatch(/BETWEEN :c0 AND :c1/);
      expect(Object.values(parameters)).toEqual([10, 20]);
    });

    it('in → "= ANY(:param)" with the raw array', () => {
      const { sql, parameters } = compile({
        field: 'currentStage',
        operator: 'in',
        value: ['AP1', 'AP2'],
      });
      expect(norm(sql)).toMatch(/= ANY\(:c0\)/);
      expect(Object.values(parameters)).toEqual([['AP1', 'AP2']]);
    });

    it('notIn → "<> ALL(:param)"', () => {
      const { sql } = compile({
        field: 'currentStage',
        operator: 'notIn',
        value: ['AP1'],
      });
      expect(norm(sql)).toMatch(/<> ALL\(:c0\)/);
    });

    it('contains → LIKE with %wrapped% escaped param', () => {
      const { sql, parameters } = compile({
        field: 'currentStage',
        operator: 'contains',
        value: 'A',
      });
      expect(norm(sql)).toMatch(/LIKE :c0 ESCAPE/);
      expect(Object.values(parameters)).toEqual(['%A%']);
    });

    it('contains escapes LIKE metacharacters in the value', () => {
      const { parameters } = compile({
        field: 'currentStage',
        operator: 'contains',
        value: '50%_x',
      });
      expect(Object.values(parameters)).toEqual(['%50\\%\\_x%']);
    });

    it('startsWith → "value%"', () => {
      const { parameters } = compile({
        field: 'currentStage',
        operator: 'startsWith',
        value: 'AP',
      });
      expect(Object.values(parameters)).toEqual(['AP%']);
    });

    it('endsWith → "%value"', () => {
      const { parameters } = compile({
        field: 'currentStage',
        operator: 'endsWith',
        value: '1',
      });
      expect(Object.values(parameters)).toEqual(['%1']);
    });

    it.each([
      ['exists', 'IS NOT NULL'],
      ['isNotNull', 'IS NOT NULL'],
      ['notExists', 'IS NULL'],
      ['isNull', 'IS NULL'],
    ])('presence operator %s → %s (no params)', (operator, sqlFrag) => {
      const { sql, parameters } = compile({
        field: 'currentStage',
        operator: operator as any,
      });
      expect(norm(sql)).toContain(sqlFrag);
      expect(Object.keys(parameters)).toHaveLength(0);
    });
  });

  describe('JSONB fields', () => {
    it('eq on a json string field uses #>> text extraction', () => {
      const { sql, parameters } = compile({
        field: 'industryData.estadoCobro',
        operator: 'eq',
        value: 'AP1',
      });
      expect(norm(sql)).toContain(`d."industryData" #>> '{estadoCobro}'`);
      expect(Object.values(parameters)).toEqual(['AP1']);
    });

    it('gt on a json field guards the numeric cast so bad rows do not abort', () => {
      const { sql } = compile({
        field: 'industryData.cuotasEnMora',
        operator: 'gt',
        value: 5,
      });
      // Guarded cast: only numeric-looking text is cast to numeric.
      expect(norm(sql)).toMatch(/CASE WHEN/);
      expect(norm(sql)).toMatch(/~ '\^/);
      expect(norm(sql)).toContain('AS numeric');
    });
  });

  describe('date fields (day-granular, tenant-tz)', () => {
    const TZ = 'America/Argentina/Buenos_Aires';
    const compileTz = (condition: Condition) =>
      service.compile(condition, { resolveField, timeZone: TZ });

    it('lte on a date column → strictly before the NEXT tenant-local day (fixes the off-by-one)', () => {
      const { sql, parameters } = compileTz({
        field: 'createdAt',
        operator: 'lte',
        value: '2026-08-14',
      });
      // Field kept as a raw instant (sargable), compared against next-day midnight.
      expect(norm(sql)).toContain('CAST((d."createdAt") AS timestamptz)');
      expect(norm(sql)).toMatch(
        /< \(CAST\(CAST\(:c\d+ AS date\) \+ 1 AS timestamp\) AT TIME ZONE :c\d+\)/,
      );
      // No raw "<= midnight" and no epoch-millis form for dates anymore.
      expect(norm(sql)).not.toContain('<=');
      expect(norm(sql)).not.toContain('EXTRACT(EPOCH');
      expect(Object.values(parameters)).toContain('2026-08-14');
      expect(Object.values(parameters)).toContain(TZ);
    });

    it('gte on a date column → at-or-after the tenant-local day start (no +1)', () => {
      const { sql } = compileTz({
        field: 'createdAt',
        operator: 'gte',
        value: '2026-08-01',
      });
      expect(norm(sql)).toMatch(
        />= \(CAST\(CAST\(:c\d+ AS date\) AS timestamp\) AT TIME ZONE :c\d+\)/,
      );
      expect(norm(sql)).not.toContain('+ 1 AS timestamp');
    });

    it('lt on a date column → strictly before the tenant-local day start', () => {
      const { sql } = compileTz({
        field: 'createdAt',
        operator: 'lt',
        value: '2026-08-14',
      });
      expect(norm(sql)).toMatch(
        /< \(CAST\(CAST\(:c\d+ AS date\) AS timestamp\) AT TIME ZONE :c\d+\)/,
      );
      expect(norm(sql)).not.toContain('+ 1 AS timestamp');
    });

    it('gt on a date column → at-or-after the NEXT tenant-local day', () => {
      const { sql } = compileTz({
        field: 'createdAt',
        operator: 'gt',
        value: '2026-08-14',
      });
      expect(norm(sql)).toMatch(
        />= \(CAST\(CAST\(:c\d+ AS date\) \+ 1 AS timestamp\) AT TIME ZONE :c\d+\)/,
      );
    });

    it('eq on a date column → a half-open [dayStart, nextDayStart) range', () => {
      const { sql } = compileTz({
        field: 'createdAt',
        operator: 'eq',
        value: '2026-08-14',
      });
      expect(norm(sql)).toMatch(/>= \(CAST\(CAST\(:c\d+ AS date\) AS timestamp\)/);
      expect(norm(sql)).toContain('AND');
      expect(norm(sql)).toMatch(/< \(CAST\(CAST\(:c\d+ AS date\) \+ 1 AS timestamp\)/);
    });

    it('between on a date column → [loDayStart, hiNextDayStart)', () => {
      const { sql, parameters } = compileTz({
        field: 'createdAt',
        operator: 'between',
        value: ['2026-08-01', '2026-08-14'],
      });
      expect(norm(sql)).toMatch(/>= \(CAST\(CAST\(:c\d+ AS date\) AS timestamp\)/);
      expect(norm(sql)).toMatch(/< \(CAST\(CAST\(:c\d+ AS date\) \+ 1 AS timestamp\)/);
      expect(Object.values(parameters)).toEqual(
        expect.arrayContaining(['2026-08-01', '2026-08-14', TZ]),
      );
    });

    it('a JSONB date field guards the timestamptz cast so junk rows resolve to NULL', () => {
      const { sql } = compileTz({
        field: 'industryData.fechaAlta',
        operator: 'lte',
        value: '2026-08-14',
      });
      expect(norm(sql)).toMatch(/CASE WHEN .+ THEN CAST\(.+ AS timestamptz\) END/);
      expect(norm(sql)).toContain('AT TIME ZONE');
    });

    it('defaults to UTC day boundaries when no timeZone option is supplied', () => {
      const { parameters } = compile({
        field: 'createdAt',
        operator: 'lte',
        value: '2026-08-14',
      });
      expect(Object.values(parameters)).toContain('UTC');
    });

    it('an ISO-timestamp value is floored to its calendar date', () => {
      const { parameters } = compileTz({
        field: 'createdAt',
        operator: 'lte',
        value: '2026-08-14T17:30:00.000Z',
      });
      expect(Object.values(parameters)).toContain('2026-08-14');
    });
  });

  describe('boolean composition', () => {
    it('and → parenthesised AND chain', () => {
      const { sql } = compile({
        and: [
          { field: 'currentStage', operator: 'eq', value: 'AP1' },
          { field: 'grupo', operator: 'gte', value: 5 },
        ],
      });
      expect(norm(sql)).toMatch(/\(.+ AND .+\)/);
    });

    it('or → parenthesised OR chain', () => {
      const { sql } = compile({
        or: [
          { field: 'currentStage', operator: 'eq', value: 'AP1' },
          { field: 'currentStage', operator: 'eq', value: 'AP2' },
        ],
      });
      expect(norm(sql)).toMatch(/\(.+ OR .+\)/);
    });

    it('not → NOT (...)', () => {
      const { sql } = compile({
        not: { field: 'currentStage', operator: 'eq', value: 'AP1' },
      });
      expect(norm(sql)).toMatch(/NOT \(/);
    });

    it('empty and → TRUE (matches every row)', () => {
      const { sql } = compile({ and: [] });
      expect(norm(sql)).toBe('TRUE');
    });

    it('empty or → FALSE (matches no row)', () => {
      const { sql } = compile({ or: [] });
      expect(norm(sql)).toBe('FALSE');
    });

    it('allocates a distinct param per leaf', () => {
      const { parameters } = compile({
        and: [
          { field: 'currentStage', operator: 'eq', value: 'AP1' },
          { field: 'grupo', operator: 'eq', value: 5 },
        ],
      });
      expect(Object.keys(parameters).sort()).toEqual(['c0', 'c1']);
      expect(parameters.c0).toBe('AP1');
      expect(parameters.c1).toBe(5);
    });
  });

  describe('unresolvable field', () => {
    it('emits FALSE and reports a warning instead of throwing', () => {
      const { sql, warnings } = compile({
        field: 'nope.unknown',
        operator: 'eq',
        value: 'x',
      });
      expect(norm(sql)).toContain('FALSE');
      expect(warnings).toContain('nope.unknown');
    });

    it('a FALSE leaf inside an OR does not match', () => {
      const { sql } = compile({
        or: [
          { field: 'nope', operator: 'eq', value: 'x' },
          { field: 'currentStage', operator: 'eq', value: 'AP1' },
        ],
      });
      expect(norm(sql)).toMatch(/\(FALSE OR .+\)/);
    });
  });
});
