-- Create database
CREATE DATABASE IF NOT EXISTS library_management;
USE library_management;

-- Create books table
CREATE TABLE IF NOT EXISTS books (
    book_id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255) NOT NULL,
    language VARCHAR(50) NOT NULL,
    genre VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    status_code_id VARCHAR(20) DEFAULT '',
    status_description VARCHAR(50),
    book_register_date DATE,
    book_deleted_date DATE NULL,
    borrowed_count INT DEFAULT 0,
    synced_to_api BOOLEAN DEFAULT FALSE,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert sample books
INSERT INTO books (title, author, language, genre, price, status_code_id, book_register_date, synced_to_api) VALUES
('The Great Gatsby', 'F. Scott Fitzgerald', 'English', 'Fiction', 299.99, 'AVAIL', CURDATE(), TRUE),
('Think and Grow Rich', 'Napoleon Hill', 'English', 'Self-Help', 199.99, 'AVAIL', CURDATE(), TRUE),
('1984', 'George Orwell', 'English', 'Dystopian', 249.99, 'AVAIL', CURDATE(), TRUE);

-- Verify
SELECT * FROM books;