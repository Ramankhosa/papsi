// Simple test to verify Jest setup is working
describe('Test Setup', () => {
  test('should run basic test', () => {
    expect(1 + 1).toBe(2)
  })

  test('should have localStorage mock', () => {
    expect(typeof localStorage.getItem).toBe('function')
    expect(typeof localStorage.setItem).toBe('function')
  })

  test('should have fetch mock', () => {
    expect(typeof fetch).toBe('function')
  })

  test('should have TextEncoder polyfill', () => {
    expect(typeof TextEncoder).toBe('function')
    expect(typeof TextDecoder).toBe('function')
  })
})
