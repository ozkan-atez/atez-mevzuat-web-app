import axios from 'axios'

export const api = axios.create({
  baseURL: '/api', // Proxy sayesinde doğrudan /api adresine atıyoruz
  withCredentials: true,
})

// Test amaçlı, Fastify backendine giderken sahte yetki tokeni ekliyoruz
api.interceptors.request.use((config) => {
  config.headers.Authorization = 'Bearer mock-token'
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.warn('⚠️ Yetkisiz erişim, kullanıcı Login sayfasına yönlendirilmeli.')
    }
    return Promise.reject(error)
  }
)
