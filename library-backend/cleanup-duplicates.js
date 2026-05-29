const mysql = require('mysql2');

const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Anu@12345',
    database: 'library_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const promiseDb = db.promise();

async function cleanupDuplicates() {
    console.log("=".repeat(50));
    console.log("🔍 DUPLICATE BOOK CLEANUP TOOL");
    console.log("=".repeat(50));
    
    try {
        // Step 1: Find all duplicates (Fixed query)
        console.log("\n📊 Step 1: Finding duplicate books...");
        
        const [duplicates] = await promiseDb.query(`
            SELECT 
                LOWER(TRIM(title)) as title_key,
                LOWER(TRIM(author)) as author_key,
                MIN(title) as title,
                MIN(author) as author,
                COUNT(*) as duplicate_count,
                GROUP_CONCAT(book_id ORDER BY book_count DESC) as book_ids,
                GROUP_CONCAT(book_count ORDER BY book_count DESC) as book_counts,
                GROUP_CONCAT(updated_date ORDER BY book_count DESC) as updated_dates
            FROM books 
            WHERE book_deleted_date IS NULL
            GROUP BY LOWER(TRIM(title)), LOWER(TRIM(author))
            HAVING COUNT(*) > 1
        `);
        
        if (duplicates.length === 0) {
            console.log("✅ No duplicates found! Database is clean.");
            process.exit(0);
        }
        
        console.log(`\n📚 Found ${duplicates.length} book(s) with duplicates:\n`);
        
        duplicates.forEach(dup => {
            console.log(`   📖 "${dup.title}" by ${dup.author}`);
            console.log(`      Duplicates: ${dup.duplicate_count}`);
            console.log(`      Book IDs: ${dup.book_ids}`);
            console.log(`      Counts: ${dup.book_counts}`);
            console.log("");
        });
        
        // Step 2: Ask for confirmation
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        readline.question('\n❓ Delete duplicates and keep highest book count? (yes/no): ', async (answer) => {
            if (answer.toLowerCase() !== 'yes') {
                console.log("❌ Cleanup cancelled.");
                readline.close();
                process.exit(0);
            }
            
            console.log("\n🔄 Step 2: Deleting duplicates...");
            
            // Delete duplicates, keep the one with highest book count
            const [result] = await promiseDb.query(`
                DELETE b1 FROM books b1
                INNER JOIN books b2 
                ON LOWER(TRIM(b1.title)) = LOWER(TRIM(b2.title)) 
                AND LOWER(TRIM(b1.author)) = LOWER(TRIM(b2.author))
                AND b1.book_count < b2.book_count
                WHERE b1.book_deleted_date IS NULL
                AND b2.book_deleted_date IS NULL
            `);
            
            console.log(`✅ Deleted ${result.affectedRows} duplicate record(s)`);
            
            // Step 3: Verify cleanup
            console.log("\n🔍 Step 3: Verifying cleanup...");
            
            const [remaining] = await promiseDb.query(`
                SELECT COUNT(*) as total FROM books WHERE book_deleted_date IS NULL
            `);
            
            const [remainingDuplicates] = await promiseDb.query(`
                SELECT COUNT(*) as dup_count FROM (
                    SELECT COUNT(*) 
                    FROM books 
                    WHERE book_deleted_date IS NULL
                    GROUP BY LOWER(TRIM(title)), LOWER(TRIM(author))
                    HAVING COUNT(*) > 1
                ) as dup_check
            `);
            
            console.log(`📚 Total books remaining: ${remaining[0].total}`);
            
            if (remainingDuplicates[0].dup_count === 0) {
                console.log("✅ Database is now clean! No duplicates remain.");
            } else {
                console.log("⚠️ Some duplicates still remain. Running second pass...");
                
                // Second pass for any remaining duplicates
                const [result2] = await promiseDb.query(`
                    DELETE b1 FROM books b1
                    INNER JOIN books b2 
                    ON LOWER(TRIM(b1.title)) = LOWER(TRIM(b2.title)) 
                    AND LOWER(TRIM(b1.author)) = LOWER(TRIM(b2.author))
                    AND b1.book_id > b2.book_id
                    WHERE b1.book_deleted_date IS NULL
                    AND b2.book_deleted_date IS NULL
                `);
                
                console.log(`✅ Second pass deleted ${result2.affectedRows} record(s)`);
            }
            
            // Step 4: Show final book list
            console.log("\n📋 Step 4: Final book list:");
            
            const [finalBooks] = await promiseDb.query(`
                SELECT 
                    book_id,
                    title,
                    author,
                    book_count,
                    CASE 
                        WHEN book_count > 0 THEN 'Available'
                        ELSE 'Not Available'
                    END as status
                FROM books 
                WHERE book_deleted_date IS NULL
                ORDER BY title
            `);
            
            console.table(finalBooks);
            
            console.log("\n✅ Cleanup completed successfully!");
            readline.close();
            process.exit(0);
        });
        
    } catch (error) {
        console.error("❌ Error during cleanup:", error);
        process.exit(1);
    }
}

cleanupDuplicates();