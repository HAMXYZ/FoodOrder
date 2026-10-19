import asyncio
import models
from database import init_db, ping_db, engine

async def main():
    try:
        await ping_db()
        print("Ket noi MySQL thanh cong!")

        await init_db()
        print("Da khoi tao cac bang trong database!")

        print("Cac bang:")
        for table_name in models.Base.metadata.tables:
            print("-", table_name)
    except Exception as e:
        print("LOI:", repr(e))
    finally:
        await engine.dispose()

asyncio.run(main())
