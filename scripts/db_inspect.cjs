const { Client } = require('pg');
require('dotenv').config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: url });
  await client.connect();

  const columnsQuery =
    "SELECT table_name, column_name, data_type, udt_name, column_default, is_nullable " +
    "FROM information_schema.columns " +
    "WHERE table_schema='public' " +
    "  AND table_name IN ('document','workspace','user_preference') " +
    "  AND column_name IN ('id','created_at','updated_at') " +
    "ORDER BY table_name, column_name";

  const columns = await client.query(columnsQuery);
  console.log('\nColumns:');
  console.table(columns.rows);

  const idx = await client.query(
    "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('document','workspace','user_preference') ORDER BY tablename, indexname"
  );

  console.log('\nIndexes:');
  for (const row of idx.rows) {
    console.log(`- ${row.tablename}.${row.indexname}: ${row.indexdef}`);
  }

  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
