import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding data...')
  
  // 1. Create a dummy user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@atez.com' },
    update: {},
    create: {
      email: 'admin@atez.com',
      name: 'Admin User',
      role: 'ADMIN',
    },
  })

  console.log('Created admin user:', admin.email)

  // 2. Create a document source
  const source = await prisma.source.upsert({
    where: { key: 'resmi-gazete' },
    update: {},
    create: {
      key: 'resmi-gazete',
      baseUrl: 'https://www.resmigazete.gov.tr',
      authorityType: 'OFFICIAL',
    },
  })

  console.log('Created source:', source.key)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
