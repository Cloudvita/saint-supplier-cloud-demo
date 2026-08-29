import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET() {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      return NextResponse.json(
        { status: 'error', message: 'DATABASE_URL environment variable is missing' },
        { status: 500 }
      );
    }

    // Initialize Neon client
    const sql = neon(databaseUrl);

    // Run a lightweight test query and check supplier table count
    const result = await sql`
      SELECT 
        NOW() AS current_time, 
        version() AS postgres_version,
        (SELECT COUNT(*) FROM suppliers) AS supplier_count;
    `;

    return NextResponse.json({
      status: 'success',
      connected: true,
      data: {
        databaseTime: result[0].current_time,
        postgresVersion: result[0].postgres_version,
        totalSuppliers: result[0].supplier_count ?? 0,
      },
    });
  } catch (error: any) {
    console.error('Neon DB Connection Failed:', error);
    return NextResponse.json(
      {
        status: 'error',
        connected: false,
        message: error.message || 'Failed to query Neon PostgreSQL',
      },
      { status: 500 }
    );
  }
}
