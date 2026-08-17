from typing import Optional, Dict, List, Any
import asyncpg
from datetime import datetime
import uuid
import json
import os

class ModuleMonitorService:
    def __init__(self, pool: asyncpg.pool.Pool):
        """
        初始化ModuleMonitorService类
        :param pool: 数据库连接池
        """
        self.pool = pool

    async def update_module_stats(
        self,
        module_name: str,  # 模块名称，用于标识要更新的模块
        is_success: bool,  # 布尔值，表示操作是否成功
        conn: Optional[asyncpg.Connection] = None  # 可选的数据库连接参数，如果提供则使用该连接
    ) -> Dict:  # 返回值类型为字典
        async def _execute(connection):  # 内部异步函数，用于执行实际的数据库操作
            # 使用 FOR UPDATE 锁定指定模块的记录，防止并发修改
            module = await connection.fetchrow(
                "SELECT id FROM module_monitor WHERE module_name = $1 FOR UPDATE",
                module_name
            )
            
            # 如果模块记录不存在，则插入新记录
            if not module:
                # 插入新记录，初始处理文件数为1，根据is_success设置成功或失败数
                return await connection.fetchrow(
                    """
                    INSERT INTO module_monitor (
                        module_name, files_processed_num,
                        success_num, failure_num
                    ) VALUES ($1, 1, $2, $3)
                    RETURNING *
                    """,
                    module_name, 
                    1 if is_success else 0,  # 成功数：1如果成功，0如果失败
                    1 - (1 if is_success else 0)  # 失败数：与成功数相反
                )
            else:

                # 如果模块记录已存在，则更新计数器
                field = "success_num" if is_success else "failure_num"  # 根据操作结果选择要更新的字段
                # 更新文件处理总数、成功/失败数和更新时间
                return await connection.fetchrow(
                    f"""
                    UPDATE module_monitor SET
                        files_processed_num = files_processed_num + 1,
                        {field} = {field} + 1,
                        updated_time = NOW()
                    WHERE id = $1
                    RETURNING *
                    """,
                    module['id']  # 使用模块ID作为更新条件
                )

        # 如果提供了数据库连接，直接使用该连接执行操作
        if conn:
            return await _execute(conn)
        else:
            # 如果没有提供连接，从连接池获取新连接，并在事务中执行操作
            async with self.pool.acquire() as conn:
                async with conn.transaction():  # 确保操作在事务中执行
                    return await _execute(conn)
                
    async def log_api_request(
        self,
        endpoint_path: str,
        status_code: int,
        response_time: float,
        error_msg: str,
        extra_messages: Optional[List[str]] = None,
        conn: Optional[asyncpg.Connection] = None
    ) -> Dict:
        """
        记录API请求结果到数据库
        :param endpoint_path: API端点路径
        :param status_code: HTTP状态码
        :param response_time: 响应时间(毫秒)
        :param extra_messages: 额外消息列表
        :param conn: 可选数据库连接
        """
        async def _execute(connection):
            # 构建结果数据
            

            record = await connection.fetchrow(
                """
                INSERT INTO api_request_results (
                    request_id, endpoint_path, status_code,
                    response_time, result_data, error_message
                ) VALUES (
                    $1, $2, $3, $4, $5, $6
                ) RETURNING *
                """,
                str(uuid.uuid4()),
                endpoint_path,
                status_code,
                response_time,
                json.dumps(extra_messages),
                error_msg[:500] if error_msg else None  # 限制错误消息长度
            )
            '''
            if record:
                # 确保所有字段都可序列化
                return {
                    "request_id": record["request_id"],
                    "endpoint_path": record["endpoint_path"],
                    "status_code": record["status_code"],
                    "response_time": record["response_time"],
                    "result_data": json.loads(record["result_data"]),  # 确保JSON字段被解析为字典
                    "error_message": record["error_message"],
                    "created_time": record["created_time"].isoformat() if record["created_time"] else None
                }
            '''
            return {}

        if conn:
            return await _execute(conn)
        else:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    return await _execute(conn)
                

    # ============ 新增的文档存储方法 ============
    
    async def create_batch(self, user_id: int, batch_name: Optional[str] = None, 
                          conn: Optional[asyncpg.Connection] = None) -> int:
        """创建新的批次记录（兼容原有连接参数）"""
        if not batch_name:
            batch_name = f"Batch_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        query = """
        INSERT INTO batch (name, created_at, user_id)
        VALUES ($1, NOW(), $2)
        RETURNING id
        """
        params = (batch_name, user_id)
        
        if conn:
            result = await conn.fetchrow(query, *params)
        else:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    result = await conn.fetchrow(query, *params)
        
        return result['id'] if result else None

    async def create_document(
        self,
        batch_id: int,
        filename: str,
        filetype: str,
        document_type: str,
        filesize: int,
        filepath: Optional[str] = None,
        conn: Optional[asyncpg.Connection] = None
    ) -> int:
        """创建文档记录（兼容原有连接参数）"""
        if not filepath:
            # 生成唯一存储路径
            unique_id = uuid.uuid4().hex
            filepath = f"storage/{unique_id}/{filename}"
        
        query = """
        INSERT INTO document 
        (filename, filepath, filesize, filetype, document_type, created_at, batch_id)
        VALUES ($1, $2, $3, $4, $5, NOW(), $6)
        RETURNING id
        """
        params = (
            filename, 
            filepath, 
            filesize, 
            filetype, 
            document_type, 
            batch_id
        )
        
        if conn:
            result = await conn.fetchrow(query, *params)
        else:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    result = await conn.fetchrow(query, *params)
        
        return result['id'] if result else None

    async def create_pages_no_docid(
        self,
        pages_data: List[Dict[str, Any]],
        conn: Optional[asyncpg.Connection] = None
    ) -> None:
        """批量创建页面记录（兼容原有连接参数）"""
        if not pages_data:
            return

        # 准备批量插入的数据
        values = []
        for page in pages_data:
            values.append((
                page.get('page', 1),
                page.get('text_content', ''),
                json.dumps(page.get('analysis', {})),
                page.get('detection_status', 'processed'),
                page.get('document_id')
            ))

        
        query = """
        INSERT INTO page 
        (page_number, text_content, analysis_results, detection_status, document_id)
        VALUES ($1, $2, $3, $4, $5)
        """
        
        if conn:
            await conn.executemany(query, values)
        else:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    await conn.executemany(query, values)
    
    async def create_pages(
        self,
        document_id: int,
        pages_data: List[Dict[str, Any]],
        conn: Optional[asyncpg.Connection] = None
    ) -> None:
        """批量创建页面记录（兼容原有连接参数）"""
        if not pages_data:
            return
            
        # 准备批量插入的数据
        values = []
        for page in pages_data:
            values.append((
                page.get('page', 1),
                page.get('text_content', ''),
                json.dumps(page.get('analysis', {})),
                page.get('detection_status', 'processed'),
                document_id
            ))
        
        query = """
        INSERT INTO page 
        (page_number, text_content, analysis_results, detection_status, document_id)
        VALUES ($1, $2, $3, $4, $5)
        """
        
        if conn:
            await conn.executemany(query, values)
        else:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    await conn.executemany(query, values)

    async def save_analysis_results(
        self,
        user_id: int,
        files: List[Dict[str, Any]],
        module_name: str,
        conn: Optional[asyncpg.Connection] = None
    ) -> None:
        """
        公共方法：保存分析结果到数据库
        使用参数化的连接，可以加入已有事务
        """
        # 创建批次（使用同一个连接）
        batch_id = await self.create_batch(
            user_id=user_id,
            batch_name=f"{module_name}_Analysis_{datetime.now().strftime('%Y%m%d')}",
            conn=conn
        )
        
        if not batch_id:
            raise Exception("创建批次失败")
        
        # 处理每个文件
        for file_data in files:
            # 获取文件大小（如果提供）
            filesize = file_data.get('filesize', 
                                  os.path.getsize(file_data.get('file_path', '')) 
                                  if file_data.get('file_path') else 0)
            
            # 创建文档记录
            doc_id = await self.create_document(
                batch_id=batch_id,
                filename=file_data['filename'],
                filetype=file_data['type'],
                document_type=file_data['type'],
                filesize=filesize,
                conn=conn
            )
            
            if not doc_id:
                continue
                
            # 根据文件类型创建页面
            pages_data = []
            if file_data['type'] == 'image' or 'image' in file_data['type']:
                # 单页文档
                pages_data.append({
                    "page_number": 1,
                    "analysis": file_data.get('analysis', file_data.get('pages', {})),
                    "detection_status": "processed"
                })
            elif file_data['type'] == 'pdf' or 'pdf' in file_data['type']:
                # 多页文档
                pages_data = file_data.get('pages', file_data.get('analysis', []))
            
            # 批量创建页面
            if pages_data:
                await self.create_pages(
                    document_id=doc_id,
                    pages_data=pages_data,
                    conn=conn
                )

    async def create_job(
        self, 
        batch_id: int,
        status: str = 'processing',
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
        conn: Optional[asyncpg.Connection] = None
    ) -> int:
        """创建作业记录"""
        started_at = started_at or datetime.utcnow()
        query = """
        INSERT INTO job (status, started_at, completed_at, batch_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        """
        params = (status, started_at, completed_at, batch_id)
        
        if conn:
            result = await conn.fetchrow(query, *params)
        else:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    result = await conn.fetchrow(query, *params)
        return result['id'] if result else None

    async def update_job_status(
        self,
        job_id: int,
        status: str,
        completed_at: Optional[datetime] = None,
        conn: Optional[asyncpg.Connection] = None
    ) -> None:
        """更新作业状态"""
        completed_at = completed_at or datetime.utcnow() if status == 'completed' else None
        query = """
        UPDATE job 
        SET status = $1, completed_at = $2
        WHERE id = $3
        """
        params = (status, completed_at, job_id)
        
        if conn:
            await conn.execute(query, *params)
        else:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(query, *params)