---
name: spark
description: PySpark code style rules from the Palantir style guide. Use
  every time you write, review, or refactor PySpark code (DataFrame API,
  spark.sql.functions, joins, window functions).
---

# Spark

Opinionated rules for readable, maintainable PySpark. Based on the
Palantir PySpark style guide. Apply these to all PySpark code you write,
review, or refactor. For general Python style, follow the Google
PyGuide.

Standard imports:

```python
from pyspark.sql import types as T, functions as F, Window as W
```

## Column selection

Prefer string column names. Use `F.col('x')` when a function is needed.
Avoid direct access (`df.colA`), except to disambiguate a join.

```python
# bad
df = df.select(F.lower(df1.colA), F.upper(df2.colB))

# good (Spark 3.0+)
df = df.select(F.lower('colA'), F.upper('colB'))
```

Direct access breaks reuse, breaks on renamed variables, and encourages
short dataframe names. Give dataframes descriptive names.

## Logical operations

Keep logic in `.filter()` or `F.when()` to at most 3 expressions per
block. Extract anything longer into named boolean variables.

```python
# good
has_operator = (
    (F.col('originalOperator') != '') | (F.col('currentOperator') != '')
)
delivery_date_passed = (
    F.datediff('deliveryDate_actual', 'current_date') < 0
)
has_registration = F.col('currentRegistration').rlike('.+')
is_delivered = F.col('prod_status') == 'Delivered'
is_active = has_registration | has_operator

F.when(is_delivered | (delivery_date_passed & is_active), 'In Service')
```

## Select as a schema contract

Put a `select` at the start of a transform, or before returning. It
states the schema contract for the reader and the next step.

- Allow at most one `spark.sql.functions` call per selected column,
  plus an optional `.alias()`. More than 3 such uses in one select:
  refactor into a `clean_<dataframe>()` function.
- No multi-dataframe expressions or `.when()` inside a select unless
  needed for performance.
- Cluster operations of the same type together.

```python
# good
aircraft = aircraft.select(
    'aircraft_id',
    'aircraft_msn',
    'aircraft_type',
    'operator_code',
    F.col('aircraft_registration').alias('registration'),
    F.col('number_of_economy_seats').cast('long'),
    F.avg('staleness').alias('avg_staleness'),
)
```

Alias in the select instead of `withColumnRenamed()`. Cast in the
select instead of a separate `withColumn()`.

```python
# bad
df.select('key', 'comments').withColumnRenamed('comments', 'num_comments')

# good
df.select('key', F.col('comments').alias('num_comments'))
```

Select an explicit set of columns rather than relying on `.drop()`,
except after joins, where dropping redundant columns is fine. Use
`.withColumn()` to add a single column; use one `.select()` when adding
or changing tens of columns (performance).

## Empty columns

Use `F.lit(None)` to fill an empty column. Never `''` or `'NA'`. This
keeps `isNull` checks working.

## Comments

Refactor instead of commenting what the code does. Comment only the
why: data quirks, consumer expectations, decisions that took digging to
reach.

## UDFs

Avoid UDFs. They are far slower than native PySpark. Almost all UDF
logic can be rewritten with native functions.

## Joins

- Always pass `how=` explicitly, even for inner:
  `df.join(other, 'key', how='inner')`.
- Never use right joins. Swap dataframe order and use `how='left'`.
- Check the join key is unique on the right side, or you get a join
  explosion (duplicated rows).
- Never use `.dropDuplicates()` or `.distinct()` to hide duplicate
  rows from a bad join. Find the underlying cause.
- Avoid renaming columns to dodge collisions. Alias the dataframes and
  select through the alias:

```python
# good
flights = flights.alias('flights')
parking = parking.alias('parking')

flights = flights.join(parking, on='flight_code', how='left')

flights = flights.select(
    F.col('flights.start_time').alias('flight_start_time'),
    F.col('parking.total_time').alias('client_parking_total_time'),
)
```

Drop or rename overlapping columns before the join if possible, and
always resolve ambiguous columns before writing output.

## Window functions

Always give an explicit frame with `rowsBetween` or `rangeBetween`.
Spark's implicit frame changes with ordering and gives surprising
results for `F.first()`, `F.last()` and `F.sum()`.

```python
# good
w = (
    W.partitionBy('key')
    .orderBy('num')
    .rowsBetween(W.unboundedPreceding, W.unboundedFollowing)
)
```

- Analytic functions do not skip nulls. Use
  `F.first('num', ignorenulls=True)` and friends.
- Order nulls explicitly with `F.asc_nulls_first` / `F.asc_nulls_last`
  when it matters.
- Avoid empty `W.partitionBy()`. It forces all data into one partition.
  Use `.agg()` instead:

```python
# bad
df = df.select(F.sum('num').over(W.partitionBy()).alias('sum'))

# good
df = df.agg(F.sum('num').alias('sum'))
```

## Chaining

- Maximum 5 chained expressions per block.
- Do not mix operation types in one chain (e.g. selecting and
  filtering with joining or column creation). Split into separate
  assignments per logical step.
- Chains longer than 3 statements are candidates for extraction into a
  named function.
- Wrap chains in parentheses. Never use `\` line continuations.

```python
# good
df = (
    df
    .filter(F.col('event') == 'executing')
    .filter(F.col('has_tests') == True)
    .drop('has_tests')
)

df = df.withColumn('boverc', F.col('b') / F.col('c'))

df = df.join(df2, 'key', how='inner')
```

## General

1. Keep files under 250 lines and functions under 70.
2. Keep related lines together in logical blocks.
3. Test your code, or manually verify the built datasets.
4. Avoid `.otherwise(value)` as a general fallback. It masks unknown
   keys into one value.
5. No commented-out code in the repository. Use git history.
6. Split large multi-source transforms into functions per natural
   sub-step.
7. Name functions and variables for what they do, not the objects they
   touch.
8. Avoid new import aliases beyond the established
   `from pyspark.sql import types as T, functions as F`.
9. No literal strings or magic numbers in filters or column values.
   Extract them into named variables, constants, or dicts.
