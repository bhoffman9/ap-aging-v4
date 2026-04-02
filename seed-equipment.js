// Seed equipment table with truck fleet data
// Run: node seed-equipment.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://bhdaiddrfeqtwjlsfifx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoZGFpZGRyZmVxdHdqbHNmaWZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjA2MzMsImV4cCI6MjA5MDE5NjYzM30.YUaaFRM-BfJSAEb12WP_rWMv40uDfioWx82KCFMGHzc'
);

const trucks = [
  { fleet_number: '440', vendor: 'TCI', vendor_unit: '26440', vin: '3AKJHLDV7TSWN4160', make: 'Freightliner', model: 'CA126DC', year: '2026', type: 'Day Cab', category: 'truck', monthly_cost: 2248, mileage_rate: 0.07, contract: 'Lease 1710', status: 'Active' },
  { fleet_number: '441', vendor: 'TCI', vendor_unit: '26441', vin: '3AKJHLDV9TSWN4161', make: 'Freightliner', model: 'CA126DC', year: '2026', type: 'Day Cab', category: 'truck', monthly_cost: 2248, mileage_rate: 0.07, contract: 'Lease 1711', status: 'Active' },
  { fleet_number: '569', vendor: 'TCI', vendor_unit: '26569', vin: '3AKJHLDV1TSWN4283', make: 'Freightliner', model: 'CA126DC', year: '2026', type: 'Day Cab', category: 'truck', monthly_cost: 2248, mileage_rate: 0.07, contract: 'Lease 1712', status: 'Active' },
  { fleet_number: '570', vendor: 'TCI', vendor_unit: '26570', vin: '3AKJHLDV3TSWN4284', make: 'Freightliner', model: 'CA126DC', year: '2026', type: 'Day Cab', category: 'truck', monthly_cost: 2248, mileage_rate: 0.07, contract: 'Lease 1713', status: 'Active' },
  { fleet_number: '573', vendor: 'TCI', vendor_unit: '26573', vin: '3AKJHLDV9TSWN4287', make: 'Freightliner', model: 'CA126DC', year: '2026', type: 'Day Cab', category: 'truck', monthly_cost: 2248, mileage_rate: 0.07, contract: 'Lease 1714', status: 'Active' },
  { fleet_number: '189', vendor: 'TCI', vendor_unit: '19129', vin: '1FVACWD24KHKE5088', make: 'Freightliner', model: 'M2106', year: '2019', type: 'Box Truck', category: 'truck', monthly_cost: 2130, mileage_rate: 0, contract: 'Rental 1700', status: 'Active' },
  { fleet_number: '120', vendor: 'Penske', vendor_unit: '587120', type: 'Sleeper', category: 'truck', monthly_cost: 2737, contract: 'Contract', status: 'Active' },
  { fleet_number: '127', vendor: 'Penske', vendor_unit: '587127', type: 'Sleeper', category: 'truck', monthly_cost: 2737, contract: 'New Jan 26', status: 'Active' },
  { fleet_number: '\u2014', vendor: 'Penske', vendor_unit: '585443', type: 'Sleeper', category: 'truck', monthly_cost: 0, contract: 'Credit 1/25/26', status: 'Out of Service' },
  { fleet_number: '149', vendor: 'TEC', vendor_unit: '101149', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '476', vendor: 'TEC', vendor_unit: '101476', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '568', vendor: 'TEC', vendor_unit: '101568', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '574', vendor: 'TEC', vendor_unit: '101574', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '577', vendor: 'TEC', vendor_unit: '101577', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '589', vendor: 'TEC', vendor_unit: '101589', type: 'Day Cab', category: 'truck', monthly_cost: 2083, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '676', vendor: 'TEC', vendor_unit: '101676', type: 'Day Cab', category: 'truck', monthly_cost: 2083, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '728', vendor: 'TEC', vendor_unit: '101728', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '730', vendor: 'TEC', vendor_unit: '101730', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '731', vendor: 'TEC', vendor_unit: '101731', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '738', vendor: 'TEC', vendor_unit: '101738', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
  { fleet_number: '729', vendor: 'TEC', vendor_unit: '101729', type: 'Sleeper', category: 'truck', monthly_cost: 2289, mileage_rate: 0.092, contract: 'Agr #875', status: 'Active' },
];

async function seed() {
  console.log(`Inserting ${trucks.length} trucks...`);

  const { data, error } = await supabase
    .from('equipment')
    .insert(trucks)
    .select();

  if (error) {
    console.error('Error inserting trucks:', error.message);
    console.error('Details:', error.details);
    console.error('Hint:', error.hint);
    process.exit(1);
  }

  console.log(`Successfully inserted ${data.length} trucks.`);
  console.log('Sample:', data[0]);
}

seed();
