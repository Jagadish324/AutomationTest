Feature: Login Functionality
  @Test
  Scenario: Validate Successful login with valid credential
    Given I open the login page
    When I enter the username  and password
    And I click on login button