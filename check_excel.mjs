const XLSX = require('xlsx');

const filePath = 'C:/Dev - New/Windsurff invoice/AVT-ESKO HK Feb 2026.xlsx';
console.log('Reading:', filePath);

try {
  const workbook = XLSX.readFile(filePath);
  console.log('Sheet names:', workbook.SheetNames);
  
  // Read first sheet
  const sheet1 = workbook.Sheets[workbook.SheetNames[0]];
  const data1 = XLSX.utils.sheet_to_json(sheet1, { header: 1 });
  console.log('\nFirst sheet rows:', data1.length);
  console.log('First 3 rows:');
  data1.slice(0, 3).forEach((row, i) => {
    console.log(`Row ${i}:`, row);
  });
} catch(e) {
  console.error('Error:', e.message);
}
