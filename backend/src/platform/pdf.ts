import axios from 'axios'
import FormData from 'form-data'

export async function generatePdfFromHtml(htmlContent: string): Promise<Buffer> {
  const form = new FormData()
  
  // Gotenberg, index.html isimli bir dosya bekler
  form.append('files', Buffer.from(htmlContent), {
    filename: 'index.html',
    contentType: 'text/html'
  })

  // Gerçek ortamda Docker iç ağı ismi kullanılır (örn: http://gotenberg:3000)
  const gotenbergUrl = process.env.GOTENBERG_URL || 'http://localhost:3333'

  const response = await axios.post(`${gotenbergUrl}/forms/chromium/convert/html`, form, {
    headers: form.getHeaders(),
    responseType: 'arraybuffer'
  })

  return Buffer.from(response.data)
}
