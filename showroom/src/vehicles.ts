export const vehicles = [
  { id: 'vision-gt', name: '小米 Vision GT', make: 'XIAOMI', model: 'VISION GT', file: 'vision-gt', flowFolder: '/flow', flowKind: 'cfd', articulated: true, paintMaterials: ['accent'], swatch: '#95E7DF' },
  { id: 'su7-ultra', name: '小米 SU7 Ultra', make: 'XIAOMI', model: 'SU7 ULTRA', file: 'su7-ultra', flowFolder: '/flow/su7-ultra', flowKind: 'potential', articulated: false, paintMaterials: ['CarPaint'], swatch: '#B9BEC1' },
  { id: 'mclaren-vgt', name: '迈凯伦 Ultimate Vision GT', make: 'McLAREN', model: 'ULTIMATE VISION GT', file: 'mclaren-vgt', flowFolder: '/flow/mclaren-vgt', flowKind: 'potential', articulated: false, paintMaterials: ['body_1', 'body_2'], swatch: '#313539' },
] as const

export type VehicleId = typeof vehicles[number]['id']
export const vehicleById = (id: VehicleId) => vehicles.find(vehicle => vehicle.id === id)!
