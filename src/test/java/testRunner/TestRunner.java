package testRunner;


import io.cucumber.junit.Cucumber;
import io.cucumber.junit.CucumberOptions;
import org.junit.runner.RunWith;

@RunWith(Cucumber.class)
@CucumberOptions(
        features = "src/test/resources/Features",
        glue = "StepDefinition",
//        tags = "@Test",
        dryRun = false,
        stepNotifications = true,
        monochrome = true,
        plugin = {}
)


public class TestRunner {
}
