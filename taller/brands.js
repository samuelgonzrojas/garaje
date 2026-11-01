// Marcas de recambio y lubricantes habituales en los talleres españoles, para
// autocompletar. Se puede escribir cualquier otra.
export const BRANDS = [
  // Filtros
  'Mann-Filter', 'Mahle', 'Knecht', 'Hengst', 'Purflux', 'UFI', 'Fram', 'Bosch', 'Filtron', 'Champion',
  // Frenos
  'Brembo', 'ATE', 'TRW', 'Ferodo', 'Textar', 'Jurid', 'Pagid', 'Bendix', 'Mintex', 'Zimmermann', 'Galfer',
  // Distribución, embrague, rodamientos, correas
  'Gates', 'Dayco', 'Contitech', 'INA', 'SKF', 'LuK', 'Sachs', 'Valeo', 'Aisin', 'Exedy', 'FAG', 'SNR',
  // Encendido, inyección, electricidad
  'NGK', 'Denso', 'Beru', 'Delphi', 'Magneti Marelli', 'Pierburg', 'Hella', 'Osram', 'Philips', 'Varta', 'Exide', 'Bosch Batteries',
  // Suspensión, dirección, otros
  'Monroe', 'KYB', 'Bilstein', 'Lemförder', 'Febi Bilstein', 'Meyle', 'Swag', 'Topran', 'Vemo', 'Lucas', 'Blue Print', 'Corteco',
  'Elring', 'Victor Reinz', 'Ajusa', 'Garrett', 'Nissens', 'Behr', 'NRF', 'Walker', 'Bosal',
  // Neumáticos
  'Michelin', 'Continental', 'Pirelli', 'Bridgestone', 'Goodyear', 'Dunlop', 'Hankook', 'Firestone',
  // Lubricantes y líquidos
  'Castrol', 'Mobil', 'Shell', 'Total', 'Elf', 'Repsol', 'Cepsa', 'Motul', 'Liqui Moly', 'Fuchs', 'Ravenol', 'Valvoline',
  // Original
  'Original (OE)',
];

// Marcas de coches, furgonetas y motos, para el alta de vehículos. Se puede
// escribir cualquier otra.
export const CAR_MAKES = [
  'Abarth', 'Alfa Romeo', 'Aprilia', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'BYD', 'Citroën', 'Cupra', 'Dacia', 'Dodge', 'DS', 'Ducati', 'Ferrari', 'Fiat', 'Ford', 'Harley-Davidson',
  'Honda', 'Hyundai', 'Infiniti', 'Isuzu', 'Iveco', 'Jaguar', 'Jeep', 'Kawasaki', 'Kia', 'KTM', 'Lada', 'Lamborghini', 'Lancia', 'Land Rover', 'Lexus', 'Lynk & Co', 'Maserati', 'Mazda',
  'Mercedes-Benz', 'MG', 'Mini', 'Mitsubishi', 'Nissan', 'Omoda', 'Opel', 'Peugeot', 'Piaggio', 'Polestar', 'Porsche', 'Renault', 'Rover', 'Saab', 'Seat', 'Skoda', 'Smart', 'SsangYong / KGM',
  'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Triumph', 'Vespa', 'Volkswagen', 'Volvo', 'Yamaha',
];

// Buscar una referencia: Google encuentra equivalencias y distribuidores.
export const searchUrl = (brand, ref) =>
  'https://www.google.com/search?q=' + encodeURIComponent([brand, ref].filter(Boolean).join(' '));
