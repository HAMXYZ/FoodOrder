import asyncio
from database import init_db,AsyncSessionLocal,engine
import models
import extended_models
from services import seed_menu
async def main():
    await init_db()
    async with AsyncSessionLocal() as db:
        await seed_menu(db)
    print('Da khoi tao schema va thuc don. Khong ghi de du lieu da co.')
    await engine.dispose()
if __name__=='__main__':
    asyncio.run(main())
